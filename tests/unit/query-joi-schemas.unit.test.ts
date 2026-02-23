/**
 * Query Joi Schema Unit Tests
 *
 * Pure in-process tests — zero database dependencies.
 * Validates every rule in querySchemas including:
 *  - Required field enforcement
 *  - String length boundaries (min/max)
 *  - Enum allowlists
 *  - Integer / positive / range constraints
 *  - .or() peer requirements
 *  - New schemas: acceptResolution, rejectResolution, bulkStatus, bulkClose, bulkReassign
 *
 * Run with: npx jest unit/query-joi-schemas
 */

import { describe, it, expect } from '@jest/globals';
import Joi from 'joi';
import { querySchemas } from '../../src/middleware/validation.middleware';

// ─── Helper ────────────────────────────────────────────────────────────────
function validate(schema: Joi.Schema, value: unknown) {
  return schema.validate(value, { abortEarly: true, convert: true });
}

function err(schema: Joi.Schema, value: unknown): string | null {
  return validate(schema, value).error?.message ?? null;
}

function ok(schema: Joi.Schema, value: unknown): unknown {
  const { error, value: v } = validate(schema, value);
  if (error) throw new Error(`Unexpected validation error: ${error.message}`);
  return v;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. querySchemas.create
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.create', () => {
  const base = {
    description: 'Verify date of birth against source documents',
    queryType: 'Query',
    studyId: 1
  };

  // ── Required fields ──────────────────────────────────────────────────────
  it('passes with minimal valid payload', () => {
    expect(err(querySchemas.create, base)).toBeNull();
  });

  it('fails when description is absent', () => {
    const { description: _, ...rest } = base;
    const e = err(querySchemas.create, rest);
    expect(e).toMatch(/required/i);
  });

  it('fails when queryType is absent', () => {
    const { queryType: _, ...rest } = base;
    const e = err(querySchemas.create, rest);
    expect(e).toMatch(/required/i);
  });

  it('fails when studyId is absent', () => {
    const { studyId: _, ...rest } = base;
    const e = err(querySchemas.create, rest);
    expect(e).toMatch(/required/i);
  });

  // ── description boundary ─────────────────────────────────────────────────
  it('fails when description is 9 chars (< min 10)', () => {
    expect(err(querySchemas.create, { ...base, description: '123456789' }))
      .toMatch(/at least 10 characters/i);
  });

  it('passes when description is exactly 10 chars (boundary)', () => {
    expect(err(querySchemas.create, { ...base, description: '1234567890' })).toBeNull();
  });

  it('passes when description is exactly 1000 chars (boundary)', () => {
    expect(err(querySchemas.create, { ...base, description: 'a'.repeat(1000) })).toBeNull();
  });

  it('fails when description is 1001 chars (> max 1000)', () => {
    expect(err(querySchemas.create, { ...base, description: 'a'.repeat(1001) }))
      .toMatch(/1000 characters/i);
  });

  // ── queryType enum ────────────────────────────────────────────────────────
  it.each(['Query', 'Failed Validation Check', 'Annotation', 'Reason for Change'])(
    'passes valid queryType: "%s"',
    (qt) => {
      expect(err(querySchemas.create, { ...base, queryType: qt })).toBeNull();
    }
  );

  it('fails for unknown queryType', () => {
    expect(err(querySchemas.create, { ...base, queryType: 'Complaint' }))
      .toMatch(/queryType must be one of/i);
  });

  it('is case-sensitive for queryType', () => {
    expect(err(querySchemas.create, { ...base, queryType: 'query' })).toBeTruthy();
  });

  // ── studyId integer constraints ───────────────────────────────────────────
  it('fails for studyId = 0', () => {
    expect(err(querySchemas.create, { ...base, studyId: 0 })).toBeTruthy();
  });

  it('fails for studyId = -1', () => {
    expect(err(querySchemas.create, { ...base, studyId: -1 })).toBeTruthy();
  });

  it('fails for non-integer studyId (float)', () => {
    expect(err(querySchemas.create, { ...base, studyId: 1.5 })).toBeTruthy();
  });

  it('fails for string studyId "abc"', () => {
    expect(err(querySchemas.create, { ...base, studyId: 'abc' })).toBeTruthy();
  });

  it('Joi coerces string "5" to number 5 for studyId (convert: true)', () => {
    const result = validate(querySchemas.create, { ...base, studyId: '5' });
    // Convert mode should coerce "5" → 5
    expect(result.error).toBeUndefined();
    expect((result.value as any).studyId).toBe(5);
  });

  // ── entityType enum ───────────────────────────────────────────────────────
  it.each(['itemData', 'eventCrf', 'studySubject', 'studyEvent'])(
    'passes valid entityType: "%s"',
    (et) => {
      expect(err(querySchemas.create, { ...base, entityType: et })).toBeNull();
    }
  );

  it('fails for invalid entityType', () => {
    expect(err(querySchemas.create, { ...base, entityType: 'patient' }))
      .toMatch(/entityType must be one of/i);
  });

  // ── detailedNotes ─────────────────────────────────────────────────────────
  it('passes with empty detailedNotes (allow empty string)', () => {
    expect(err(querySchemas.create, { ...base, detailedNotes: '' })).toBeNull();
  });

  it('passes with detailedNotes of 2000 chars (boundary)', () => {
    expect(err(querySchemas.create, { ...base, detailedNotes: 'x'.repeat(2000) })).toBeNull();
  });

  it('fails with detailedNotes of 2001 chars', () => {
    expect(err(querySchemas.create, { ...base, detailedNotes: 'x'.repeat(2001) })).toBeTruthy();
  });

  // ── optional integer fields ───────────────────────────────────────────────
  it.each(['assignedUserId', 'subjectId', 'entityId', 'crfId', 'eventCrfId', 'itemId'])(
    'fails for negative %s',
    (field) => {
      expect(err(querySchemas.create, { ...base, [field]: -1 })).toBeTruthy();
    }
  );

  it.each(['assignedUserId', 'subjectId', 'entityId', 'crfId', 'eventCrfId', 'itemId'])(
    'fails for zero %s',
    (field) => {
      expect(err(querySchemas.create, { ...base, [field]: 0 })).toBeTruthy();
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. querySchemas.respond
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.respond', () => {
  it('passes with description only', () => {
    expect(err(querySchemas.respond, { description: 'A response of sufficient length here' })).toBeNull();
  });

  it('passes with response only (alias)', () => {
    expect(err(querySchemas.respond, { response: 'A response of sufficient length here' })).toBeNull();
  });

  it('passes with both description and response', () => {
    expect(err(querySchemas.respond, {
      description: 'Response description field content',
      response: 'Response field content duplicate'
    })).toBeNull();
  });

  it('fails when neither description nor response is provided', () => {
    const e = err(querySchemas.respond, { detailedNotes: 'Only notes' });
    expect(e).toBeTruthy();
    expect(e).toMatch(/description.*response|must contain at least one/i);
  });

  it('fails when response is empty string (< 10 chars)', () => {
    expect(err(querySchemas.respond, { response: '' })).toBeTruthy();
  });

  it('fails when response is < 10 chars', () => {
    expect(err(querySchemas.respond, { response: 'Too short' }))
      .toMatch(/at least 10 characters/i);
  });

  it('passes when response is exactly 10 chars', () => {
    expect(err(querySchemas.respond, { response: '1234567890' })).toBeNull();
  });

  it('fails when response is > 1000 chars', () => {
    expect(err(querySchemas.respond, { response: 'x'.repeat(1001) }))
      .toMatch(/1000 characters/i);
  });

  it('passes when response is exactly 1000 chars', () => {
    expect(err(querySchemas.respond, { response: 'x'.repeat(1000) })).toBeNull();
  });

  it.each([2, 3, 4])('passes newStatusId %i (valid response status)', (id) => {
    expect(err(querySchemas.respond, {
      response: 'A valid response to this query for status test',
      newStatusId: id
    })).toBeNull();
  });

  it('fails newStatusId = 1 (New — cannot set via respond)', () => {
    expect(err(querySchemas.respond, {
      response: 'A valid response to this query for status test',
      newStatusId: 1
    })).toMatch(/must be 2/i);
  });

  it('fails newStatusId = 5 (Not Applicable — cannot set via respond)', () => {
    expect(err(querySchemas.respond, {
      response: 'A valid response to this query for status test',
      newStatusId: 5
    })).toBeTruthy();
  });

  it('fails newStatusId = 0', () => {
    expect(err(querySchemas.respond, {
      response: 'A valid response to this query for status test',
      newStatusId: 0
    })).toBeTruthy();
  });

  it('allows empty detailedNotes', () => {
    expect(err(querySchemas.respond, {
      response: 'Valid response text here enough chars',
      detailedNotes: ''
    })).toBeNull();
  });

  it('fails detailedNotes > 2000 chars', () => {
    expect(err(querySchemas.respond, {
      response: 'Valid response text here enough chars',
      detailedNotes: 'x'.repeat(2001)
    })).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. querySchemas.updateStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.updateStatus', () => {
  it.each([1, 2, 3, 4, 5])('passes statusId = %i', (id) => {
    expect(err(querySchemas.updateStatus, { statusId: id })).toBeNull();
  });

  it('fails statusId = 0', () => {
    expect(err(querySchemas.updateStatus, { statusId: 0 })).toBeTruthy();
  });

  it('fails statusId = 6 (previously allowed up to 10, now fixed)', () => {
    expect(err(querySchemas.updateStatus, { statusId: 6 })).toBeTruthy();
  });

  it('fails statusId = 10', () => {
    expect(err(querySchemas.updateStatus, { statusId: 10 })).toBeTruthy();
  });

  it('fails when statusId is absent', () => {
    expect(err(querySchemas.updateStatus, {})).toMatch(/required/i);
  });

  it('fails for float statusId', () => {
    expect(err(querySchemas.updateStatus, { statusId: 1.5 })).toBeTruthy();
  });

  it('fails for string statusId', () => {
    expect(err(querySchemas.updateStatus, { statusId: 'closed' })).toBeTruthy();
  });

  it('accepts optional reason field', () => {
    expect(err(querySchemas.updateStatus, { statusId: 4, reason: 'Query resolved' })).toBeNull();
  });

  it('accepts empty reason string', () => {
    expect(err(querySchemas.updateStatus, { statusId: 4, reason: '' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. querySchemas.acceptResolution
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.acceptResolution', () => {
  it('passes with empty body (all optional)', () => {
    expect(err(querySchemas.acceptResolution, {})).toBeNull();
  });

  it('passes with reason string', () => {
    expect(err(querySchemas.acceptResolution, { reason: 'Data verified' })).toBeNull();
  });

  it('passes with empty reason string', () => {
    expect(err(querySchemas.acceptResolution, { reason: '' })).toBeNull();
  });

  it('passes with meaning string', () => {
    expect(err(querySchemas.acceptResolution, {
      reason: 'OK',
      meaning: 'I have reviewed and confirm the resolution is acceptable'
    })).toBeNull();
  });

  it('fails reason exceeding 500 chars', () => {
    expect(err(querySchemas.acceptResolution, { reason: 'x'.repeat(501) })).toBeTruthy();
  });

  it('passes reason of exactly 500 chars', () => {
    expect(err(querySchemas.acceptResolution, { reason: 'x'.repeat(500) })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. querySchemas.rejectResolution
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.rejectResolution', () => {
  it('requires reason', () => {
    const e = err(querySchemas.rejectResolution, {});
    expect(e).toBeTruthy();
    expect(e).toMatch(/required|empty/i);
  });

  it('fails when reason is empty string', () => {
    expect(err(querySchemas.rejectResolution, { reason: '' })).toBeTruthy();
  });

  it('fails when reason is < 10 chars', () => {
    const e = err(querySchemas.rejectResolution, { reason: 'Too short' });
    expect(e).toMatch(/at least 10 characters/i);
  });

  it('passes when reason is exactly 10 chars', () => {
    expect(err(querySchemas.rejectResolution, { reason: '1234567890' })).toBeNull();
  });

  it('passes a valid reason', () => {
    expect(err(querySchemas.rejectResolution, {
      reason: 'Source document shows different value. Please re-verify measurement.'
    })).toBeNull();
  });

  it('fails reason > 500 chars', () => {
    expect(err(querySchemas.rejectResolution, { reason: 'x'.repeat(501) })).toBeTruthy();
  });

  it('passes reason of exactly 500 chars', () => {
    expect(err(querySchemas.rejectResolution, { reason: 'x'.repeat(500) })).toBeNull();
  });

  it('reason cannot be whitespace-only (empty after trim by Joi)', () => {
    // Joi doesn't trim by default, but empty string validation fires
    const e = err(querySchemas.rejectResolution, { reason: '   ' });
    // "   " is 3 chars which is < 10 — should fail on min length
    expect(e).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. querySchemas.bulkStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.bulkStatus', () => {
  const base = { queryIds: [1, 2, 3], statusId: 4 };

  it('passes with valid payload', () => {
    expect(err(querySchemas.bulkStatus, base)).toBeNull();
  });

  it('fails with empty queryIds array', () => {
    expect(err(querySchemas.bulkStatus, { ...base, queryIds: [] })).toBeTruthy();
  });

  it('fails when queryIds is absent', () => {
    expect(err(querySchemas.bulkStatus, { statusId: 4 })).toBeTruthy();
  });

  it('fails when statusId is absent', () => {
    expect(err(querySchemas.bulkStatus, { queryIds: [1] })).toBeTruthy();
  });

  it('fails for invalid statusId = 6', () => {
    expect(err(querySchemas.bulkStatus, { ...base, statusId: 6 })).toBeTruthy();
  });

  it.each([1, 2, 3, 4, 5])('passes valid statusId %i', (id) => {
    expect(err(querySchemas.bulkStatus, { ...base, statusId: id })).toBeNull();
  });

  it('fails for negative ID in queryIds array', () => {
    expect(err(querySchemas.bulkStatus, { ...base, queryIds: [1, -1, 2] })).toBeTruthy();
  });

  it('fails for zero ID in queryIds array', () => {
    expect(err(querySchemas.bulkStatus, { ...base, queryIds: [1, 0, 2] })).toBeTruthy();
  });

  it('accepts optional reason field', () => {
    expect(err(querySchemas.bulkStatus, { ...base, reason: 'Closing per study protocol' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. querySchemas.bulkClose
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.bulkClose', () => {
  it('passes with queryIds array', () => {
    expect(err(querySchemas.bulkClose, { queryIds: [1, 2] })).toBeNull();
  });

  it('fails with empty array', () => {
    expect(err(querySchemas.bulkClose, { queryIds: [] })).toBeTruthy();
  });

  it('fails when queryIds is absent', () => {
    expect(err(querySchemas.bulkClose, {})).toBeTruthy();
  });

  it('accepts with optional reason', () => {
    expect(err(querySchemas.bulkClose, { queryIds: [1], reason: 'Data verified' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. querySchemas.bulkReassign
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.bulkReassign', () => {
  const base = { queryIds: [1, 2], assignToUserId: 5 };

  it('passes with valid payload', () => {
    expect(err(querySchemas.bulkReassign, base)).toBeNull();
  });

  it('fails when assignToUserId is absent', () => {
    expect(err(querySchemas.bulkReassign, { queryIds: [1] })).toMatch(/required/i);
  });

  it('fails for negative assignToUserId', () => {
    expect(err(querySchemas.bulkReassign, { ...base, assignToUserId: -1 })).toBeTruthy();
  });

  it('fails for zero assignToUserId', () => {
    expect(err(querySchemas.bulkReassign, { ...base, assignToUserId: 0 })).toBeTruthy();
  });

  it('fails with empty queryIds', () => {
    expect(err(querySchemas.bulkReassign, { queryIds: [], assignToUserId: 5 })).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. querySchemas.list
// ═══════════════════════════════════════════════════════════════════════════

describe('querySchemas.list', () => {
  it('passes with empty object (all optional)', () => {
    expect(err(querySchemas.list, {})).toBeNull();
  });

  it('passes with all filters specified', () => {
    expect(err(querySchemas.list, {
      studyId: 1,
      subjectId: 2,
      status: 'New',
      page: 2,
      limit: 50
    })).toBeNull();
  });

  it.each(['New', 'Updated', 'Resolution Proposed', 'Closed', 'Not Applicable'])(
    'passes status: "%s"',
    (s) => {
      expect(err(querySchemas.list, { status: s })).toBeNull();
    }
  );

  it('fails for invalid status string', () => {
    expect(err(querySchemas.list, { status: 'Open' })).toBeTruthy();
  });

  it('fails for page < 1', () => {
    expect(err(querySchemas.list, { page: 0 })).toBeTruthy();
  });

  it('fails for limit < 1', () => {
    expect(err(querySchemas.list, { limit: 0 })).toBeTruthy();
  });

  it('fails for limit > 1000', () => {
    expect(err(querySchemas.list, { limit: 1001 })).toBeTruthy();
  });

  it('passes limit = 1000 (boundary)', () => {
    expect(err(querySchemas.list, { limit: 1000 })).toBeNull();
  });

  it('defaults page to 1 when not specified', () => {
    const result = validate(querySchemas.list, {});
    expect((result.value as any).page).toBe(1);
  });

  it('defaults limit to 20 when not specified', () => {
    const result = validate(querySchemas.list, {});
    expect((result.value as any).limit).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Cross-schema data type consistency
// ═══════════════════════════════════════════════════════════════════════════

describe('Schema data type consistency', () => {
  it('all ID fields require positive integers', () => {
    // A value of 1.5 (float) should fail for any ID field
    const floatId = 1.5;
    expect(err(querySchemas.create, {
      description: 'Test description for type check',
      queryType: 'Query',
      studyId: floatId
    })).toBeTruthy();

    expect(err(querySchemas.bulkReassign, {
      queryIds: [1],
      assignToUserId: floatId
    })).toBeTruthy();
  });

  it('string descriptions cannot be numbers', () => {
    expect(err(querySchemas.create, {
      description: 12345,
      queryType: 'Query',
      studyId: 1
    })).toBeTruthy();
  });

  it('newStatusId in respond schema accepts only 2, 3, 4 — not any integer 1-5', () => {
    // Status 1 (New) should not be settable via a response
    expect(err(querySchemas.respond, {
      response: 'Response text of sufficient length here',
      newStatusId: 1
    })).toBeTruthy();

    // Status 5 (Not Applicable) should not be settable via a response
    expect(err(querySchemas.respond, {
      response: 'Response text of sufficient length here',
      newStatusId: 5
    })).toBeTruthy();
  });

  it('updateStatus statusId accepts only 1-5 (not any number)', () => {
    // statusId used to allow 1-10 — verify that gap is closed
    for (const bad of [0, 6, 7, 8, 9, 10, -1]) {
      expect(err(querySchemas.updateStatus, { statusId: bad })).toBeTruthy();
    }
  });
});
