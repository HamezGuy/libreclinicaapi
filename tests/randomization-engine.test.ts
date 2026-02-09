/**
 * Randomization Engine Tests
 * 
 * Tests the new server-side randomization engine:
 * - Config creation, update, retrieval
 * - Sealed list generation (permuted block, stratified)
 * - Subject randomization from sealed list
 * - Allocation concealment & balance verification
 * - Activation/locking
 * - Edge cases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as engine from '../src/services/database/randomization-engine.service';
import { createTestStudy, createTestSubject } from './fixtures/test-data';

describe('Randomization Engine', () => {
  let testStudyId: number;
  let groupClassId: number;
  let groupAId: number;
  let groupBId: number;
  let subjectIds: number[] = [];
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    // Create test study
    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `ENGINE-TEST-${Date.now()}`,
      name: 'Engine Test Study'
    });

    // Create study group class (treatment arms)
    const gcResult = await testDb.pool.query(`
      INSERT INTO study_group_class (study_id, name, group_class_type_id, subject_assignment, status_id, date_created, owner_id)
      VALUES ($1, 'Treatment Arms', 1, 'Required', 1, NOW(), $2)
      RETURNING study_group_class_id
    `, [testStudyId, rootUserId]);
    groupClassId = gcResult.rows[0].study_group_class_id;

    // Create two treatment groups (A and B)
    const gAResult = await testDb.pool.query(`
      INSERT INTO study_group (study_group_class_id, name, description)
      VALUES ($1, 'Drug A (Active)', '50mg Drug A daily')
      RETURNING study_group_id
    `, [groupClassId]);
    groupAId = gAResult.rows[0].study_group_id;

    const gBResult = await testDb.pool.query(`
      INSERT INTO study_group (study_group_class_id, name, description)
      VALUES ($1, 'Placebo', 'Matching placebo daily')
      RETURNING study_group_id
    `, [groupClassId]);
    groupBId = gBResult.rows[0].study_group_id;

    // Create 20 test subjects
    for (let i = 1; i <= 20; i++) {
      const sid = await createTestSubject(testDb.pool, testStudyId, {
        label: `ENG-SUB-${String(i).padStart(3, '0')}`
      });
      subjectIds.push(sid);
    }
  });

  afterAll(async () => {
    try {
      // Clean up in FK order
      await testDb.pool.query(`DELETE FROM acc_randomization_list WHERE config_id IN (SELECT config_id FROM acc_randomization_config WHERE study_id = $1)`, [testStudyId]);
      await testDb.pool.query(`DELETE FROM acc_randomization_config WHERE study_id = $1`, [testStudyId]);
      await testDb.pool.query(`DELETE FROM subject_group_map WHERE study_group_class_id = $1`, [groupClassId]);
      await testDb.pool.query(`DELETE FROM audit_log_event WHERE audit_table IN ('acc_randomization_config', 'acc_randomization_list', 'subject_group_map')`);
      await testDb.pool.query(`DELETE FROM study_group WHERE study_group_class_id = $1`, [groupClassId]);
      await testDb.pool.query(`DELETE FROM study_group_class WHERE study_group_class_id = $1`, [groupClassId]);
      await testDb.pool.query(`DELETE FROM study_subject WHERE study_id = $1`, [testStudyId]);
      await testDb.pool.query(`DELETE FROM subject WHERE subject_id NOT IN (SELECT subject_id FROM study_subject)`);
      await testDb.pool.query(`DELETE FROM study_user_role WHERE study_id = $1`, [testStudyId]);
      await testDb.pool.query(`DELETE FROM study WHERE study_id = $1`, [testStudyId]);
    } catch (e: any) {
      console.warn('Engine test cleanup warning:', e.message);
    }
  });

  // Clean configs between tests to keep them isolated
  beforeEach(async () => {
    try {
      await testDb.pool.query(`DELETE FROM subject_group_map WHERE study_group_class_id = $1`, [groupClassId]);
      await testDb.pool.query(`DELETE FROM acc_randomization_list WHERE config_id IN (SELECT config_id FROM acc_randomization_config WHERE study_id = $1)`, [testStudyId]);
      await testDb.pool.query(`DELETE FROM acc_randomization_config WHERE study_id = $1`, [testStudyId]);
    } catch (e) { /* ignore */ }
  });

  // ================================================================
  // CONFIG CRUD
  // ================================================================

  describe('Configuration', () => {
    it('should save a randomization config', async () => {
      const result = await engine.saveConfig({
        studyId: testStudyId,
        name: 'Test Block Randomization',
        description: 'Block randomization 1:1',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        studyGroupClassId: groupClassId,
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      expect(result.success).toBe(true);
      expect(result.configId).toBeDefined();
      expect(typeof result.configId).toBe('number');
    });

    it('should retrieve config by study ID', async () => {
      await engine.saveConfig({
        studyId: testStudyId,
        name: 'Retrieve Test',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      const config = await engine.getConfig(testStudyId);

      expect(config).not.toBeNull();
      expect(config!.name).toBe('Retrieve Test');
      expect(config!.randomizationType).toBe('block');
      expect(config!.blindingLevel).toBe('double_blind');
      expect(config!.blockSize).toBe(4);
    });

    it('should return null for non-existent study config', async () => {
      const config = await engine.getConfig(999999);
      expect(config).toBeNull();
    });

    it('should update config when not locked', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'Before Update',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      const updateResult = await engine.updateConfig(created.configId!, { name: 'After Update' }, rootUserId);
      expect(updateResult.success).toBe(true);

      const updated = await engine.getConfigById(created.configId!);
      expect(updated!.name).toBe('After Update');
    });
  });

  // ================================================================
  // LIST GENERATION
  // ================================================================

  describe('List Generation', () => {
    it('should generate a sealed randomization list', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'List Gen Test',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      const result = await engine.generateList(created.configId!, rootUserId);

      expect(result.success).toBe(true);
      expect(result.totalEntries).toBe(20);
    });

    it('should create balanced blocks', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'Balance Test',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      await engine.generateList(created.configId!, rootUserId);

      // Check balance: within each block of 4, there should be 2 A and 2 B
      const listResult = await testDb.pool.query(`
        SELECT study_group_id, block_number FROM acc_randomization_list 
        WHERE config_id = $1 ORDER BY sequence_number
      `, [created.configId]);

      const entries = listResult.rows;
      expect(entries.length).toBe(20);

      // Check overall balance
      const groupACnt = entries.filter((e: any) => e.study_group_id === groupAId).length;
      const groupBCnt = entries.filter((e: any) => e.study_group_id === groupBId).length;
      expect(groupACnt).toBe(10);
      expect(groupBCnt).toBe(10);

      // Check block-level balance (each block of 4 has 2 of each)
      const blocks = new Map<number, number[]>();
      entries.forEach((e: any) => {
        if (!blocks.has(e.block_number)) blocks.set(e.block_number, []);
        blocks.get(e.block_number)!.push(e.study_group_id);
      });

      for (const [blockNum, assignments] of blocks) {
        const aInBlock = assignments.filter(id => id === groupAId).length;
        const bInBlock = assignments.filter(id => id === groupBId).length;
        expect(aInBlock).toBe(bInBlock); // 1:1 within each block
      }
    });

    it('should support 2:1 allocation ratios', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: '2:1 Ratio Test',
        randomizationType: 'block',
        blindingLevel: 'open_label',
        blockSize: 6, // 2+1 * 2 = 6
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 2, [groupBId]: 1 },
        totalSlots: 18,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      await engine.generateList(created.configId!, rootUserId);

      const listResult = await testDb.pool.query(`
        SELECT study_group_id FROM acc_randomization_list WHERE config_id = $1
      `, [created.configId]);

      const groupACnt = listResult.rows.filter((e: any) => e.study_group_id === groupAId).length;
      const groupBCnt = listResult.rows.filter((e: any) => e.study_group_id === groupBId).length;

      // 2:1 ratio: A should be ~2x B
      expect(groupACnt).toBe(12); // 2/3 of 18
      expect(groupBCnt).toBe(6);  // 1/3 of 18
    });

    it('should fail for config with < 2 groups', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'Single Group Fail',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1 }, // Only 1 group
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      const result = await engine.generateList(created.configId!, rootUserId);
      expect(result.success).toBe(false);
      expect(result.message?.toLowerCase()).toContain('at least 2');
    });

    it('should generate unique randomization numbers', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'Unique Numbers Test',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      await engine.generateList(created.configId!, rootUserId);

      const result = await testDb.pool.query(`
        SELECT randomization_number FROM acc_randomization_list WHERE config_id = $1
      `, [created.configId]);

      const numbers = result.rows.map((r: any) => r.randomization_number);
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBe(numbers.length); // All unique
    });
  });

  // ================================================================
  // ACTIVATION
  // ================================================================

  describe('Activation', () => {
    it('should activate a config with a generated list', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'Activation Test',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      await engine.generateList(created.configId!, rootUserId);
      const activateResult = await engine.activateConfig(created.configId!, rootUserId);

      expect(activateResult.success).toBe(true);

      const config = await engine.getConfigById(created.configId!);
      expect(config!.isActive).toBe(true);
      expect(config!.isLocked).toBe(true);
    });

    it('should fail to activate without a list', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'No List Test',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      // Don't generate list
      const result = await engine.activateConfig(created.configId!, rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('No randomization list');
    });
  });

  // ================================================================
  // SUBJECT RANDOMIZATION (the core operation)
  // ================================================================

  describe('Subject Randomization', () => {
    let activeConfigId: number;

    beforeEach(async () => {
      // Clean previous randomization data
      await testDb.pool.query(`DELETE FROM subject_group_map WHERE study_group_class_id = $1`, [groupClassId]);
      await testDb.pool.query(`DELETE FROM acc_randomization_list WHERE config_id IN (SELECT config_id FROM acc_randomization_config WHERE study_id = $1)`, [testStudyId]);
      await testDb.pool.query(`DELETE FROM acc_randomization_config WHERE study_id = $1`, [testStudyId]);

      // Create, generate, and activate a scheme
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'Active Scheme',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        studyGroupClassId: groupClassId,
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      activeConfigId = created.configId!;
      await engine.generateList(activeConfigId, rootUserId);
      await engine.activateConfig(activeConfigId, rootUserId);
    });

    it('should randomize a subject from the sealed list', async () => {
      const result = await engine.randomizeSubject(testStudyId, subjectIds[0], rootUserId);

      expect(result.success).toBe(true);
      expect(result.randomizationNumber).toBeTruthy();
      expect(result.randomizationNumber).toMatch(/^RND-/);
      expect(result.studyGroupId).toBeDefined();
      expect(result.sequenceNumber).toBe(1);
      expect(result.isBlinded).toBe(true); // double_blind
      expect(result.groupName).toBe('[Blinded]'); // Name hidden
    });

    it('should assign sequential randomization numbers', async () => {
      const r1 = await engine.randomizeSubject(testStudyId, subjectIds[0], rootUserId);
      const r2 = await engine.randomizeSubject(testStudyId, subjectIds[1], rootUserId);
      const r3 = await engine.randomizeSubject(testStudyId, subjectIds[2], rootUserId);

      expect(r1.sequenceNumber).toBe(1);
      expect(r2.sequenceNumber).toBe(2);
      expect(r3.sequenceNumber).toBe(3);
    });

    it('should prevent double randomization', async () => {
      await engine.randomizeSubject(testStudyId, subjectIds[0], rootUserId);
      const duplicate = await engine.randomizeSubject(testStudyId, subjectIds[0], rootUserId);

      expect(duplicate.success).toBe(false);
      expect(duplicate.message).toContain('already randomized');
    });

    it('should create subject_group_map entry', async () => {
      await engine.randomizeSubject(testStudyId, subjectIds[0], rootUserId);

      const sgmResult = await testDb.pool.query(
        'SELECT * FROM subject_group_map WHERE study_subject_id = $1',
        [subjectIds[0]]
      );

      expect(sgmResult.rows.length).toBe(1);
      expect([groupAId, groupBId]).toContain(sgmResult.rows[0].study_group_id);
    });

    it('should maintain balanced allocation over multiple subjects', async () => {
      // Randomize all 20 subjects
      for (let i = 0; i < 20; i++) {
        const result = await engine.randomizeSubject(testStudyId, subjectIds[i], rootUserId);
        expect(result.success).toBe(true);
      }

      // Check balance
      const stats = await engine.getListStats(activeConfigId);
      expect(stats.used).toBe(20);
      expect(stats.available).toBe(0);

      // Both groups should have exactly 10 (1:1 ratio with block size 4 over 20)
      const groupA = stats.byGroup.find(g => g.studyGroupId === groupAId);
      const groupB = stats.byGroup.find(g => g.studyGroupId === groupBId);
      expect(groupA!.used).toBe(10);
      expect(groupB!.used).toBe(10);
    });

    it('should fail when list is exhausted', async () => {
      // Randomize all 20 slots
      for (let i = 0; i < 20; i++) {
        await engine.randomizeSubject(testStudyId, subjectIds[i], rootUserId);
      }

      // Create a 21st subject
      const extraSubject = await createTestSubject(testDb.pool, testStudyId, {
        label: 'EXTRA-SUB-21'
      });

      const result = await engine.randomizeSubject(testStudyId, extraSubject, rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('No available randomization slots');
    });

    it('should fail without active scheme', async () => {
      // Use a study with no scheme
      const emptyStudyId = await createTestStudy(testDb.pool, rootUserId, {
        uniqueIdentifier: `EMPTY-ENGINE-${Date.now()}`
      });

      const result = await engine.randomizeSubject(emptyStudyId, subjectIds[0], rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('No active randomization scheme');

      // Cleanup
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [emptyStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [emptyStudyId]);
    });
  });

  // ================================================================
  // TEST PREVIEW
  // ================================================================

  describe('Test Preview', () => {
    it('should generate a preview without saving', async () => {
      const config = {
        studyId: testStudyId,
        name: 'Preview Test',
        randomizationType: 'block' as const,
        blindingLevel: 'double_blind' as const,
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      };

      const result = await engine.testConfig(config);

      expect(result.success).toBe(true);
      expect(result.preview.length).toBe(20);
      expect(result.stats.length).toBe(2);

      // Both groups should be roughly 50%
      for (const stat of result.stats) {
        expect(stat.percentage).toBeGreaterThanOrEqual(40);
        expect(stat.percentage).toBeLessThanOrEqual(60);
      }
    });
  });

  // ================================================================
  // LIST STATS
  // ================================================================

  describe('List Stats', () => {
    it('should report correct stats after randomization', async () => {
      const created = await engine.saveConfig({
        studyId: testStudyId,
        name: 'Stats Test',
        randomizationType: 'block',
        blindingLevel: 'double_blind',
        blockSize: 4,
        blockSizeVaried: false,
        allocationRatios: { [groupAId]: 1, [groupBId]: 1 },
        studyGroupClassId: groupClassId,
        totalSlots: 20,
        isActive: false,
        isLocked: false,
        drugKitManagement: false,
        siteSpecific: false,
      }, rootUserId);

      await engine.generateList(created.configId!, rootUserId);
      await engine.activateConfig(created.configId!, rootUserId);

      // Randomize 5 subjects
      for (let i = 0; i < 5; i++) {
        await engine.randomizeSubject(testStudyId, subjectIds[i], rootUserId);
      }

      const stats = await engine.getListStats(created.configId!);
      expect(stats.total).toBe(20);
      expect(stats.used).toBe(5);
      expect(stats.available).toBe(15);
      expect(stats.byStratum.length).toBe(1);
      expect(stats.byStratum[0].stratumKey).toBe('default');
    });
  });
});
