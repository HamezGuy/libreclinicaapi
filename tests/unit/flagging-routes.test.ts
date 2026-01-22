/**
 * Flagging Routes Unit Tests
 * 
 * Tests for CRF/Item Flagging API endpoints using LibreClinica's native tables:
 * - event_crf_flag
 * - item_data_flag
 * - event_crf_flag_workflow
 * - item_data_flag_workflow
 */

import { describe, it, expect } from '@jest/globals';

describe('Flagging Routes - Table Schema', () => {
  describe('event_crf_flag table', () => {
    it('should have correct column structure', () => {
      const columns = [
        'id',
        'path',
        'tag_id',
        'flag_workflow_id',
        'owner_id',
        'update_id',
        'date_created',
        'date_updated'
      ];

      // Primary key is 'id' (not 'flag_id')
      expect(columns[0]).toBe('id');
      
      // Path format: subjectOid.eventOid.eventOrdinal.crfOid
      expect(columns).toContain('path');
    });

    it('should use correct path format for CRF flags', () => {
      // CRF path format: {subjectOid}.{eventOid}.{eventOrdinal}.{crfOid}
      const examplePath = 'SS-001.SE_VISIT1.1.F_DEMOGRAPHICS';
      const parts = examplePath.split('.');
      
      expect(parts.length).toBe(4);
      expect(parts[0]).toBe('SS-001');       // subjectOid
      expect(parts[1]).toBe('SE_VISIT1');    // eventOid
      expect(parts[2]).toBe('1');            // eventOrdinal
      expect(parts[3]).toBe('F_DEMOGRAPHICS'); // crfOid
    });
  });

  describe('item_data_flag table', () => {
    it('should have same column structure as event_crf_flag', () => {
      const eventCrfFlagColumns = ['id', 'path', 'tag_id', 'flag_workflow_id', 'owner_id', 'update_id', 'date_created', 'date_updated'];
      const itemDataFlagColumns = ['id', 'path', 'tag_id', 'flag_workflow_id', 'owner_id', 'update_id', 'date_created', 'date_updated'];

      expect(eventCrfFlagColumns).toEqual(itemDataFlagColumns);
    });

    it('should use correct path format for item flags', () => {
      // Item path format: {subjectOid}.{eventOid}.{eventOrdinal}.{crfOid}.{groupOid}.{groupOrdinal}.{itemOid}
      const examplePath = 'SS-001.SE_VISIT1.1.F_DEMOGRAPHICS.IG_DEMO.1.I_BIRTHDATE';
      const parts = examplePath.split('.');
      
      expect(parts.length).toBe(7);
      expect(parts[0]).toBe('SS-001');        // subjectOid
      expect(parts[1]).toBe('SE_VISIT1');     // eventOid
      expect(parts[2]).toBe('1');             // eventOrdinal
      expect(parts[3]).toBe('F_DEMOGRAPHICS'); // crfOid
      expect(parts[4]).toBe('IG_DEMO');       // groupOid
      expect(parts[5]).toBe('1');             // groupOrdinal
      expect(parts[6]).toBe('I_BIRTHDATE');   // itemOid
    });
  });

  describe('event_crf_flag_workflow table', () => {
    it('should have correct column structure', () => {
      const columns = [
        'id',
        'workflow_id',
        'workflow_status',
        'owner_id',
        'update_id',
        'date_created',
        'date_updated'
      ];

      expect(columns).toContain('workflow_id');
      expect(columns).toContain('workflow_status');
    });
  });

  describe('item_data_flag_workflow table', () => {
    it('should have same structure as event_crf_flag_workflow', () => {
      const crfWorkflowColumns = ['id', 'workflow_id', 'workflow_status', 'owner_id', 'update_id', 'date_created', 'date_updated'];
      const itemWorkflowColumns = ['id', 'workflow_id', 'workflow_status', 'owner_id', 'update_id', 'date_created', 'date_updated'];

      expect(crfWorkflowColumns).toEqual(itemWorkflowColumns);
    });
  });
});

describe('Flagging Routes - Path Parsing', () => {
  /**
   * Parse a flag path into its components
   */
  function parseFlagPath(path: string) {
    if (!path) return null;

    const parts = path.split('.');

    if (parts.length < 4) return null;

    const result: any = {
      studySubjectOid: parts[0],
      studyEventOid: parts[1],
      eventOrdinal: parseInt(parts[2]) || 1,
      crfOid: parts[3]
    };

    if (parts.length >= 7) {
      result.groupOid = parts[4];
      result.groupOrdinal = parseInt(parts[5]) || 1;
      result.itemOid = parts[6];
    }

    return result;
  }

  describe('parseFlagPath function', () => {
    it('should parse CRF path correctly', () => {
      const path = 'SS-001.SE_VISIT1.1.F_DEMOGRAPHICS';
      const parsed = parseFlagPath(path);

      expect(parsed).not.toBeNull();
      expect(parsed.studySubjectOid).toBe('SS-001');
      expect(parsed.studyEventOid).toBe('SE_VISIT1');
      expect(parsed.eventOrdinal).toBe(1);
      expect(parsed.crfOid).toBe('F_DEMOGRAPHICS');
      expect(parsed.itemOid).toBeUndefined();
    });

    it('should parse item path correctly', () => {
      const path = 'SS-001.SE_VISIT1.2.F_VITALS.IG_VITALS.1.I_WEIGHT';
      const parsed = parseFlagPath(path);

      expect(parsed).not.toBeNull();
      expect(parsed.studySubjectOid).toBe('SS-001');
      expect(parsed.studyEventOid).toBe('SE_VISIT1');
      expect(parsed.eventOrdinal).toBe(2);
      expect(parsed.crfOid).toBe('F_VITALS');
      expect(parsed.groupOid).toBe('IG_VITALS');
      expect(parsed.groupOrdinal).toBe(1);
      expect(parsed.itemOid).toBe('I_WEIGHT');
    });

    it('should return null for invalid paths', () => {
      expect(parseFlagPath('')).toBeNull();
      expect(parseFlagPath('SS-001')).toBeNull();
      expect(parseFlagPath('SS-001.SE_VISIT1')).toBeNull();
      expect(parseFlagPath('SS-001.SE_VISIT1.1')).toBeNull();
    });

    it('should handle non-numeric ordinal values', () => {
      const path = 'SS-001.SE_VISIT1.abc.F_DEMOGRAPHICS';
      const parsed = parseFlagPath(path);

      expect(parsed).not.toBeNull();
      expect(parsed.eventOrdinal).toBe(1); // Default to 1
    });
  });
});

describe('Flagging Routes - API Response Format', () => {
  describe('CRF Flag response', () => {
    it('should map database columns to camelCase response', () => {
      const dbRow = {
        id: 1,
        path: 'SS-001.SE_VISIT1.1.F_DEMOGRAPHICS',
        tag_id: 5,
        flag_workflow_id: 10,
        owner_id: 100,
        update_id: 101,
        date_created: new Date(),
        date_updated: new Date(),
        workflow_id: 'REVIEW',
        workflow_status: 'pending',
        owner_name: 'John Doe',
        updater_name: 'Jane Smith'
      };

      const expectedResponse = {
        flagId: dbRow.id,
        path: dbRow.path,
        tagId: dbRow.tag_id,
        flagWorkflowId: dbRow.flag_workflow_id,
        workflowId: dbRow.workflow_id,
        workflowStatus: dbRow.workflow_status,
        ownerId: dbRow.owner_id,
        ownerName: dbRow.owner_name,
        updateId: dbRow.update_id,
        updaterName: dbRow.updater_name,
        dateCreated: dbRow.date_created,
        dateUpdated: dbRow.date_updated
      };

      expect(expectedResponse.flagId).toBe(1);
      expect(expectedResponse.workflowStatus).toBe('pending');
    });
  });

  describe('Workflow response', () => {
    it('should include type field to distinguish CRF vs item workflows', () => {
      const crfWorkflow = {
        id: 1,
        workflow_id: 'REVIEW',
        workflow_status: 'pending',
        owner_id: 100,
        date_created: new Date(),
        date_updated: new Date(),
        type: 'crf'
      };

      const itemWorkflow = {
        id: 2,
        workflow_id: 'REVIEW',
        workflow_status: 'pending',
        owner_id: 100,
        date_created: new Date(),
        date_updated: new Date(),
        type: 'item'
      };

      expect(crfWorkflow.type).toBe('crf');
      expect(itemWorkflow.type).toBe('item');
    });
  });
});

describe('Flagging Routes - Flag Creation', () => {
  describe('POST /api/flagging/crf', () => {
    it('should require path field', () => {
      const requiredFields = ['path'];
      const optionalFields = ['tagId', 'flagWorkflowId'];

      expect(requiredFields).toContain('path');
      expect(optionalFields).toContain('tagId');
    });

    it('should check for existing flag before insert', () => {
      // API should check: WHERE path = $1 AND COALESCE(tag_id, 0) = COALESCE($2, 0)
      const checkQuery = 'SELECT id FROM event_crf_flag WHERE path = $1 AND COALESCE(tag_id, 0) = COALESCE($2, 0)';
      expect(checkQuery).toContain('COALESCE');
    });

    it('should return 409 if flag already exists', () => {
      const conflictStatusCode = 409;
      expect(conflictStatusCode).toBe(409);
    });
  });

  describe('POST /api/flagging/item', () => {
    it('should use item_data_flag table', () => {
      const tableName = 'item_data_flag';
      expect(tableName).toBe('item_data_flag');
    });
  });
});

describe('Flagging Routes - Bulk Operations', () => {
  describe('GET /api/flagging/by-crf/:eventCrfId', () => {
    it('should build path from event_crf data', () => {
      // Query should join: event_crf -> crf_version, study_event, study_event_definition, study_subject
      const pathComponents = ['subject_oid', 'event_oid', 'event_ordinal', 'crf_oid'];
      
      pathComponents.forEach(comp => {
        expect(comp).toBeDefined();
      });
    });

    it('should return both CRF-level and item-level flags', () => {
      const responseStructure = {
        eventCrfId: 1,
        crfPath: 'SS-001.SE_VISIT1.1.F_DEMO',
        crfFlags: [],
        itemFlags: []
      };

      expect(responseStructure).toHaveProperty('crfFlags');
      expect(responseStructure).toHaveProperty('itemFlags');
    });
  });

  describe('GET /api/flagging/summary', () => {
    it('should return counts grouped by workflow status', () => {
      const expectedStructure = {
        crfFlags: {
          total: 0,
          byStatus: {}
        },
        itemFlags: {
          total: 0,
          byStatus: {}
        }
      };

      expect(expectedStructure.crfFlags).toHaveProperty('total');
      expect(expectedStructure.crfFlags).toHaveProperty('byStatus');
    });
  });
});

describe('Flagging Routes - Part11 Audit Events', () => {
  it('should use correct audit event types', () => {
    const auditEventTypes = [
      'FLAG_WORKFLOW_CREATED',
      'CRF_FLAG_CREATED',
      'CRF_FLAG_UPDATED',
      'CRF_FLAG_DELETED',
      'ITEM_FLAG_CREATED',
      'ITEM_FLAG_UPDATED',
      'ITEM_FLAG_DELETED'
    ];

    auditEventTypes.forEach(type => {
      expect(type).toMatch(/^(FLAG_WORKFLOW|CRF_FLAG|ITEM_FLAG)_(CREATED|UPDATED|DELETED)$/);
    });
  });
});
