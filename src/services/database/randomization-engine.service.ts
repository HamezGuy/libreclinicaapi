/**
 * Randomization Engine Service
 * 
 * Implements proper clinical trial randomization algorithms:
 * - Simple randomization (coin-flip)
 * - Permuted block randomization (standard for most RCTs)
 * - Stratified block randomization (block randomization within strata)
 * 
 * Features:
 * - Cryptographically secure seed generation
 * - Deterministic list generation (reproducible from seed)
 * - Pre-generated sealed lists (allocation concealment)
 * - Stratification support with independent lists per stratum
 * - Variable block sizes for added security
 * - Full audit trail integration
 * 
 * 21 CFR Part 11 Compliance:
 * - Sealed randomization lists stored server-side (§11.10(a))
 * - Allocation concealment — next assignment never exposed (§11.10(d))
 * - Audit trail for every allocation (§11.10(e))
 * - Reproducible from seed for regulatory inspection (§11.10(b))
 * 
 * References:
 * - ICH E9: Statistical Principles for Clinical Trials
 * - FDA Guidance: Adaptive Designs for Clinical Trials
 */

import crypto from 'crypto';
import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface RandomizationConfig {
  configId?: number;
  studyId: number;
  name: string;
  description?: string;
  randomizationType: 'simple' | 'block' | 'stratified';
  blindingLevel: 'open_label' | 'single_blind' | 'double_blind' | 'triple_blind';
  blockSize: number;
  blockSizeVaried: boolean;
  blockSizesList?: number[];   // e.g., [4, 6, 8] for varied sizes
  allocationRatios: Record<string, number>; // { "groupId": ratio }
  stratificationFactors?: StratificationFactor[];
  studyGroupClassId?: number;  // Link to LibreClinica group class
  seed?: string;               // Hex-encoded cryptographic seed
  totalSlots: number;
  isActive: boolean;
  isLocked: boolean;
  drugKitManagement: boolean;
  drugKitPrefix?: string;
  siteSpecific: boolean;
  createdBy?: number;
  dateCreated?: Date;
}

export interface StratificationFactor {
  name: string;
  values: string[];
}

export interface RandomizationListEntry {
  listEntryId?: number;
  configId: number;
  sequenceNumber: number;
  studyGroupId: number;
  stratumKey: string;         // e.g., 'default' or 'age:<65|gender:M'
  siteId?: number;
  blockNumber: number;
  isUsed: boolean;
  usedBySubjectId?: number;
  usedAt?: Date;
  usedByUserId?: number;
  randomizationNumber?: string;
}

export interface RandomizationResult {
  success: boolean;
  randomizationNumber: string;
  studyGroupId: number;
  groupName: string;
  sequenceNumber: number;
  stratumKey: string;
  isBlinded: boolean;
  message?: string;
}

// ============================================================================
// SEEDED PRNG (Deterministic, reproducible from seed)
// ============================================================================

/**
 * Seeded pseudo-random number generator using SHA-256.
 * Given the same seed, produces the same sequence of numbers.
 * This is critical for regulatory reproducibility.
 */
class SeededPRNG {
  private counter: number = 0;
  private seed: string;

  constructor(seed: string) {
    this.seed = seed;
  }

  /**
   * Returns a deterministic float in [0, 1) based on seed + counter
   */
  next(): number {
    const hash = crypto.createHash('sha256')
      .update(`${this.seed}:${this.counter++}`)
      .digest('hex');
    // Use first 8 hex chars (32 bits) for the number
    const value = parseInt(hash.substring(0, 8), 16);
    return value / 0x100000000;
  }

  /**
   * Returns a deterministic integer in [0, max)
   */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /**
   * Fisher-Yates shuffle using the seeded PRNG
   */
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

// ============================================================================
// LIST GENERATION
// ============================================================================

/**
 * Generate a permuted block randomization list.
 * 
 * Algorithm:
 * 1. For each block, create the required number of each treatment based on allocation ratios
 * 2. Shuffle the block using the seeded PRNG
 * 3. Repeat until we have enough slots
 * 
 * For varied block sizes, randomly select from the allowed sizes for each block.
 */
function generateBlockList(
  prng: SeededPRNG,
  groupIds: number[],
  allocationRatios: Record<string, number>,
  blockSize: number,
  blockSizeVaried: boolean,
  blockSizesList: number[],
  totalSlots: number
): { groupId: number; blockNumber: number }[] {
  const list: { groupId: number; blockNumber: number }[] = [];
  let blockNumber = 1;

  while (list.length < totalSlots) {
    // Determine this block's size
    let currentBlockSize = blockSize;
    if (blockSizeVaried && blockSizesList.length > 0) {
      currentBlockSize = blockSizesList[prng.nextInt(blockSizesList.length)];
    }

    // Build the block: each group appears (ratio * multiplier) times
    // The block size must be a multiple of the sum of ratios
    const totalRatio = groupIds.reduce((sum, gid) => sum + (allocationRatios[gid.toString()] || 1), 0);
    const multiplier = Math.max(1, Math.floor(currentBlockSize / totalRatio));

    const block: number[] = [];
    for (const gid of groupIds) {
      const ratio = allocationRatios[gid.toString()] || 1;
      const count = ratio * multiplier;
      for (let i = 0; i < count; i++) {
        block.push(gid);
      }
    }

    // Shuffle the block
    const shuffledBlock = prng.shuffle(block);

    // Add to list
    for (const groupId of shuffledBlock) {
      if (list.length < totalSlots) {
        list.push({ groupId, blockNumber });
      }
    }

    blockNumber++;
  }

  return list;
}

/**
 * Generate all stratum combinations from stratification factors.
 * E.g., factors [{name:"age", values:["<65",">=65"]}, {name:"gender", values:["M","F"]}]
 * produces: ["age:<65|gender:M", "age:<65|gender:F", "age:>=65|gender:M", "age:>=65|gender:F"]
 */
function generateStratumKeys(factors: StratificationFactor[]): string[] {
  if (!factors || factors.length === 0) return ['default'];

  let combinations: string[][] = [[]];

  for (const factor of factors) {
    const newCombinations: string[][] = [];
    for (const combo of combinations) {
      for (const value of factor.values) {
        newCombinations.push([...combo, `${factor.name}:${value}`]);
      }
    }
    combinations = newCombinations;
  }

  return combinations.map(combo => combo.join('|'));
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Save a randomization configuration to the database
 */
export const saveConfig = async (config: RandomizationConfig, userId: number): Promise<{ success: boolean; configId?: number; message?: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate cryptographic seed if not provided
    const seed = config.seed || crypto.randomBytes(32).toString('hex');

    const query = `
      INSERT INTO acc_randomization_config (
        study_id, name, description, randomization_type, blinding_level,
        block_size, block_size_varied, block_sizes_list,
        allocation_ratios, stratification_factors,
        study_group_class_id, seed, total_slots,
        is_active, is_locked, drug_kit_management, drug_kit_prefix,
        site_specific, created_by, date_created
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,CURRENT_TIMESTAMP)
      RETURNING config_id
    `;

    const result = await client.query(query, [
      config.studyId,
      config.name,
      config.description || null,
      config.randomizationType,
      config.blindingLevel,
      config.blockSize || 4,
      config.blockSizeVaried || false,
      config.blockSizesList ? JSON.stringify(config.blockSizesList) : null,
      JSON.stringify(config.allocationRatios),
      config.stratificationFactors ? JSON.stringify(config.stratificationFactors) : null,
      config.studyGroupClassId || null,
      seed,
      config.totalSlots || 100,
      false, // Not active yet
      false, // Not locked yet
      config.drugKitManagement || false,
      config.drugKitPrefix || null,
      config.siteSpecific || false,
      userId
    ]);

    const configId = result.rows[0].config_id;

    // Audit log — use type 28 (Subject Group Assignment) as closest match for randomization config
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'acc_randomization_config', $1, $2, 'Randomization Config Created', 28)
    `, [userId, configId]);

    await client.query('COMMIT');

    logger.info('Randomization config saved', { configId, studyId: config.studyId });

    return { success: true, configId };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to save randomization config', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Update an existing randomization configuration (only if not locked)
 */
export const updateConfig = async (configId: number, updates: Partial<RandomizationConfig>, userId: number): Promise<{ success: boolean; message?: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if locked
    const lockCheck = await client.query('SELECT is_locked, is_active FROM acc_randomization_config WHERE config_id = $1', [configId]);
    if (lockCheck.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Configuration is locked and cannot be modified' };
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      randomizationType: 'randomization_type',
      blindingLevel: 'blinding_level',
      blockSize: 'block_size',
      blockSizeVaried: 'block_size_varied',
      totalSlots: 'total_slots',
      drugKitManagement: 'drug_kit_management',
      drugKitPrefix: 'drug_kit_prefix',
      siteSpecific: 'site_specific',
      studyGroupClassId: 'study_group_class_id',
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${col} = $${paramIdx++}`);
        values.push((updates as any)[key]);
      }
    }

    // Handle JSON fields
    if (updates.allocationRatios !== undefined) {
      fields.push(`allocation_ratios = $${paramIdx++}`);
      values.push(JSON.stringify(updates.allocationRatios));
    }
    if (updates.stratificationFactors !== undefined) {
      fields.push(`stratification_factors = $${paramIdx++}`);
      values.push(JSON.stringify(updates.stratificationFactors));
    }
    if (updates.blockSizesList !== undefined) {
      fields.push(`block_sizes_list = $${paramIdx++}`);
      values.push(JSON.stringify(updates.blockSizesList));
    }

    fields.push(`date_updated = CURRENT_TIMESTAMP`);

    values.push(configId);
    const query = `UPDATE acc_randomization_config SET ${fields.join(', ')} WHERE config_id = $${paramIdx}`;

    await client.query(query, values);

    await client.query('COMMIT');

    logger.info('Randomization config updated', { configId });
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to update randomization config', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get randomization configuration for a study
 */
export const getConfig = async (studyId: number): Promise<RandomizationConfig | null> => {
  try {
    const result = await pool.query(
      'SELECT * FROM acc_randomization_config WHERE study_id = $1 ORDER BY date_created DESC LIMIT 1',
      [studyId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      configId: row.config_id,
      studyId: row.study_id,
      name: row.name,
      description: row.description,
      randomizationType: row.randomization_type,
      blindingLevel: row.blinding_level,
      blockSize: row.block_size,
      blockSizeVaried: row.block_size_varied,
      blockSizesList: row.block_sizes_list ? JSON.parse(row.block_sizes_list) : [],
      allocationRatios: typeof row.allocation_ratios === 'string'
        ? JSON.parse(row.allocation_ratios)
        : row.allocation_ratios || {},
      stratificationFactors: typeof row.stratification_factors === 'string'
        ? JSON.parse(row.stratification_factors)
        : row.stratification_factors || [],
      studyGroupClassId: row.study_group_class_id,
      seed: row.seed,
      totalSlots: row.total_slots,
      isActive: row.is_active,
      isLocked: row.is_locked,
      drugKitManagement: row.drug_kit_management,
      drugKitPrefix: row.drug_kit_prefix,
      siteSpecific: row.site_specific,
      createdBy: row.created_by,
      dateCreated: row.date_created,
    };
  } catch (error: any) {
    logger.error('Failed to get randomization config', { studyId, error: error.message });
    return null;
  }
};

/**
 * Get config by ID
 */
export const getConfigById = async (configId: number): Promise<RandomizationConfig | null> => {
  try {
    const result = await pool.query(
      'SELECT * FROM acc_randomization_config WHERE config_id = $1',
      [configId]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      configId: row.config_id,
      studyId: row.study_id,
      name: row.name,
      description: row.description,
      randomizationType: row.randomization_type,
      blindingLevel: row.blinding_level,
      blockSize: row.block_size,
      blockSizeVaried: row.block_size_varied,
      blockSizesList: row.block_sizes_list ? JSON.parse(row.block_sizes_list) : [],
      allocationRatios: typeof row.allocation_ratios === 'string'
        ? JSON.parse(row.allocation_ratios)
        : row.allocation_ratios || {},
      stratificationFactors: typeof row.stratification_factors === 'string'
        ? JSON.parse(row.stratification_factors)
        : row.stratification_factors || [],
      studyGroupClassId: row.study_group_class_id,
      seed: row.seed,
      totalSlots: row.total_slots,
      isActive: row.is_active,
      isLocked: row.is_locked,
      drugKitManagement: row.drug_kit_management,
      drugKitPrefix: row.drug_kit_prefix,
      siteSpecific: row.site_specific,
      createdBy: row.created_by,
      dateCreated: row.date_created,
    };
  } catch (error: any) {
    logger.error('Failed to get randomization config by id', { configId, error: error.message });
    return null;
  }
};

/**
 * Generate the sealed randomization list from a configuration.
 * This creates the "sealed envelopes" — the pre-determined sequence of treatment assignments.
 * 
 * CRITICAL: Once generated and activated, this list cannot be modified.
 */
export const generateList = async (configId: number, userId: number): Promise<{ success: boolean; totalEntries?: number; message?: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Load config
    const configResult = await client.query('SELECT * FROM acc_randomization_config WHERE config_id = $1', [configId]);
    if (configResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Configuration not found' };
    }

    const cfg = configResult.rows[0];

    if (cfg.is_locked) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Configuration is locked. List already generated.' };
    }

    const allocationRatios = typeof cfg.allocation_ratios === 'string'
      ? JSON.parse(cfg.allocation_ratios)
      : cfg.allocation_ratios || {};
    const stratFactors: StratificationFactor[] = typeof cfg.stratification_factors === 'string'
      ? JSON.parse(cfg.stratification_factors)
      : cfg.stratification_factors || [];
    const blockSizesList = cfg.block_sizes_list
      ? (typeof cfg.block_sizes_list === 'string' ? JSON.parse(cfg.block_sizes_list) : cfg.block_sizes_list)
      : [cfg.block_size];

    const groupIds = Object.keys(allocationRatios).map(Number);

    if (groupIds.length < 2) {
      await client.query('ROLLBACK');
      return { success: false, message: 'At least 2 treatment groups with allocation ratios are required' };
    }

    // Delete any existing list entries for this config (regeneration)
    await client.query('DELETE FROM acc_randomization_list WHERE config_id = $1 AND is_used = false', [configId]);

    // Generate stratum keys
    const stratumKeys = cfg.randomization_type === 'stratified'
      ? generateStratumKeys(stratFactors)
      : ['default'];

    const prng = new SeededPRNG(cfg.seed);
    let totalEntries = 0;
    const slotsPerStratum = Math.ceil(cfg.total_slots / stratumKeys.length);

    for (const stratumKey of stratumKeys) {
      let list: { groupId: number; blockNumber: number }[];

      if (cfg.randomization_type === 'simple') {
        // Simple randomization: each slot is independently random
        list = [];
        for (let i = 0; i < slotsPerStratum; i++) {
          // Weighted random selection based on allocation ratios
          const totalRatio = groupIds.reduce((sum, gid) => sum + (allocationRatios[gid.toString()] || 1), 0);
          let rand = prng.next() * totalRatio;
          let selectedGroup = groupIds[0];
          for (const gid of groupIds) {
            rand -= (allocationRatios[gid.toString()] || 1);
            if (rand <= 0) {
              selectedGroup = gid;
              break;
            }
          }
          list.push({ groupId: selectedGroup, blockNumber: 0 });
        }
      } else {
        // Block randomization (also used for stratified — just with separate lists)
        list = generateBlockList(
          prng,
          groupIds,
          allocationRatios,
          cfg.block_size,
          cfg.block_size_varied,
          blockSizesList,
          slotsPerStratum
        );
      }

      // Insert list entries
      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        const seqNum = i + 1;
        const randNum = `RND-${String(configId).padStart(3, '0')}-${String(totalEntries + 1).padStart(5, '0')}`;

        await client.query(`
          INSERT INTO acc_randomization_list (
            config_id, sequence_number, study_group_id, stratum_key,
            block_number, is_used, randomization_number, date_created
          ) VALUES ($1, $2, $3, $4, $5, false, $6, CURRENT_TIMESTAMP)
        `, [configId, seqNum, entry.groupId, stratumKey, entry.blockNumber, randNum]);

        totalEntries++;
      }
    }

    // Audit log — use type 28 (Subject Group Assignment)
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'acc_randomization_list', $1, $2, 'Randomization List Generated', NULL, $3, 28)
    `, [userId, configId, `${totalEntries} entries across ${stratumKeys.length} strata`]);

    await client.query('COMMIT');

    logger.info('Randomization list generated', { configId, totalEntries, strata: stratumKeys.length });

    return { success: true, totalEntries };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to generate randomization list', { configId, error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Activate a randomization configuration.
 * Locks it and the list so no further changes can be made.
 */
export const activateConfig = async (configId: number, userId: number): Promise<{ success: boolean; message?: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify list exists
    const listCount = await client.query(
      'SELECT COUNT(*) as cnt FROM acc_randomization_list WHERE config_id = $1',
      [configId]
    );

    if (parseInt(listCount.rows[0].cnt) === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Cannot activate: No randomization list generated. Generate the list first.' };
    }

    // Deactivate any other configs for this study
    const configResult = await client.query('SELECT study_id FROM acc_randomization_config WHERE config_id = $1', [configId]);
    const studyId = configResult.rows[0]?.study_id;

    if (studyId) {
      await client.query(
        'UPDATE acc_randomization_config SET is_active = false WHERE study_id = $1 AND config_id != $2',
        [studyId, configId]
      );
    }

    // Activate and lock
    await client.query(
      'UPDATE acc_randomization_config SET is_active = true, is_locked = true, date_updated = CURRENT_TIMESTAMP WHERE config_id = $1',
      [configId]
    );

    // Audit — use type 28 (Subject Group Assignment)
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'acc_randomization_config', $1, $2, 'Randomization Scheme Activated', 28)
    `, [userId, configId]);

    await client.query('COMMIT');

    logger.info('Randomization config activated', { configId });
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to activate config', { configId, error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * CORE FUNCTION: Randomize a subject.
 * 
 * Pulls the next unused slot from the sealed list, marks it as used,
 * and creates the subject_group_map entry in LibreClinica.
 * 
 * This is the "opening of the sealed envelope."
 */
export const randomizeSubject = async (
  studyId: number,
  studySubjectId: number,
  userId: number,
  stratumValues?: Record<string, string> // e.g., { "age": "<65", "gender": "M" }
): Promise<RandomizationResult> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get active config for this study
    const configResult = await client.query(
      'SELECT * FROM acc_randomization_config WHERE study_id = $1 AND is_active = true LIMIT 1',
      [studyId]
    );

    if (configResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        randomizationNumber: '',
        studyGroupId: 0,
        groupName: '',
        sequenceNumber: 0,
        stratumKey: '',
        isBlinded: false,
        message: 'No active randomization scheme for this study. Configure and activate a scheme first.'
      };
    }

    const cfg = configResult.rows[0];
    const configId = cfg.config_id;

    // 2. Check if subject is already randomized
    const existingCheck = await client.query(
      'SELECT COUNT(*) as cnt FROM acc_randomization_list WHERE config_id = $1 AND used_by_subject_id = $2 AND is_used = true',
      [configId, studySubjectId]
    );

    if (parseInt(existingCheck.rows[0].cnt) > 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        randomizationNumber: '',
        studyGroupId: 0,
        groupName: '',
        sequenceNumber: 0,
        stratumKey: '',
        isBlinded: false,
        message: 'Subject is already randomized'
      };
    }

    // 3. Determine stratum key
    let stratumKey = 'default';
    if (cfg.randomization_type === 'stratified' && stratumValues) {
      const factors: StratificationFactor[] = typeof cfg.stratification_factors === 'string'
        ? JSON.parse(cfg.stratification_factors)
        : cfg.stratification_factors || [];

      const parts: string[] = [];
      for (const factor of factors) {
        const value = stratumValues[factor.name];
        if (!value) {
          await client.query('ROLLBACK');
          return {
            success: false,
            randomizationNumber: '',
            studyGroupId: 0,
            groupName: '',
            sequenceNumber: 0,
            stratumKey: '',
            isBlinded: false,
            message: `Missing stratification value for factor: ${factor.name}`
          };
        }
        parts.push(`${factor.name}:${value}`);
      }
      stratumKey = parts.join('|');
    }

    // 4. Get the next unused slot from the sealed list (FIFO order)
    // Use FOR UPDATE SKIP LOCKED for concurrency safety
    const nextSlot = await client.query(`
      SELECT rl.*, sg.name as group_name
      FROM acc_randomization_list rl
      INNER JOIN study_group sg ON rl.study_group_id = sg.study_group_id
      WHERE rl.config_id = $1
        AND rl.stratum_key = $2
        AND rl.is_used = false
      ORDER BY rl.sequence_number ASC
      LIMIT 1
      FOR UPDATE OF rl SKIP LOCKED
    `, [configId, stratumKey]);

    if (nextSlot.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        randomizationNumber: '',
        studyGroupId: 0,
        groupName: '',
        sequenceNumber: 0,
        stratumKey,
        isBlinded: false,
        message: `No available randomization slots for stratum: ${stratumKey}. The list may be exhausted.`
      };
    }

    const slot = nextSlot.rows[0];

    // 5. Mark the slot as used
    await client.query(`
      UPDATE acc_randomization_list
      SET is_used = true, used_by_subject_id = $2, used_at = CURRENT_TIMESTAMP, used_by_user_id = $3
      WHERE list_entry_id = $1
    `, [slot.list_entry_id, studySubjectId, userId]);

    // 6. Create the subject_group_map entry in LibreClinica
    // Get study_group_class_id
    const groupInfo = await client.query(
      'SELECT study_group_class_id FROM study_group WHERE study_group_id = $1',
      [slot.study_group_id]
    );
    const studyGroupClassId = groupInfo.rows[0]?.study_group_class_id || cfg.study_group_class_id;

    // Check if subject already has an assignment for this group class (prevent duplicates)
    const existingAssignment = await client.query(
      'SELECT subject_group_map_id FROM subject_group_map WHERE study_subject_id = $1 AND study_group_class_id = $2',
      [studySubjectId, studyGroupClassId]
    );

    if (existingAssignment.rows.length > 0) {
      // Update existing assignment instead of creating a duplicate
      await client.query(`
        UPDATE subject_group_map 
        SET study_group_id = $1, notes = $2, date_updated = CURRENT_DATE, update_id = $3
        WHERE study_subject_id = $4 AND study_group_class_id = $5
      `, [slot.study_group_id, `Randomization: ${slot.randomization_number}`, userId, studySubjectId, studyGroupClassId]);
    } else {
      await client.query(`
        INSERT INTO subject_group_map (study_subject_id, study_group_id, study_group_class_id, owner_id, status_id, notes, date_created)
        VALUES ($1, $2, $3, $4, 1, $5, CURRENT_DATE)
      `, [studySubjectId, slot.study_group_id, studyGroupClassId, userId, `Randomization: ${slot.randomization_number}`]);
    }

    // 7. Audit log — use type 28 (Subject Group Assignment) from LibreClinica's audit_log_event_type
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'subject_group_map', $1, $2, 'Subject Randomized', NULL, $3, 28)
    `, [userId, studySubjectId, `Subject ${studySubjectId} assigned to ${slot.group_name} (${slot.randomization_number})`]);

    await client.query('COMMIT');

    const isBlinded = cfg.blinding_level !== 'open_label';

    logger.info('Subject randomized', {
      studySubjectId,
      configId,
      randomizationNumber: slot.randomization_number,
      groupId: slot.study_group_id,
      stratumKey,
      isBlinded
    });

    return {
      success: true,
      randomizationNumber: slot.randomization_number,
      studyGroupId: slot.study_group_id,
      groupName: isBlinded ? '[Blinded]' : slot.group_name,
      sequenceNumber: slot.sequence_number,
      stratumKey,
      isBlinded
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Randomization failed', { studySubjectId, error: error.message });
    return {
      success: false,
      randomizationNumber: '',
      studyGroupId: 0,
      groupName: '',
      sequenceNumber: 0,
      stratumKey: '',
      isBlinded: false,
      message: `Randomization failed: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Get list statistics — how many slots used/available per stratum
 */
export const getListStats = async (configId: number): Promise<{
  total: number;
  used: number;
  available: number;
  byStratum: { stratumKey: string; total: number; used: number; available: number }[];
  byGroup: { studyGroupId: number; groupName: string; total: number; used: number }[];
}> => {
  try {
    const stratumStats = await pool.query(`
      SELECT 
        rl.stratum_key,
        COUNT(*) as total,
        COUNT(CASE WHEN rl.is_used THEN 1 END) as used,
        COUNT(CASE WHEN NOT rl.is_used THEN 1 END) as available
      FROM acc_randomization_list rl
      WHERE rl.config_id = $1
      GROUP BY rl.stratum_key
      ORDER BY rl.stratum_key
    `, [configId]);

    const groupStats = await pool.query(`
      SELECT 
        rl.study_group_id,
        sg.name as group_name,
        COUNT(*) as total,
        COUNT(CASE WHEN rl.is_used THEN 1 END) as used
      FROM acc_randomization_list rl
      INNER JOIN study_group sg ON rl.study_group_id = sg.study_group_id
      WHERE rl.config_id = $1
      GROUP BY rl.study_group_id, sg.name
      ORDER BY sg.name
    `, [configId]);

    const total = stratumStats.rows.reduce((sum: number, r: any) => sum + parseInt(r.total), 0);
    const used = stratumStats.rows.reduce((sum: number, r: any) => sum + parseInt(r.used), 0);

    return {
      total,
      used,
      available: total - used,
      byStratum: stratumStats.rows.map((r: any) => ({
        stratumKey: r.stratum_key,
        total: parseInt(r.total),
        used: parseInt(r.used),
        available: parseInt(r.available)
      })),
      byGroup: groupStats.rows.map((r: any) => ({
        studyGroupId: r.study_group_id,
        groupName: r.group_name,
        total: parseInt(r.total),
        used: parseInt(r.used)
      }))
    };
  } catch (error: any) {
    logger.error('Failed to get list stats', { configId, error: error.message });
    return { total: 0, used: 0, available: 0, byStratum: [], byGroup: [] };
  }
};

/**
 * Test a randomization configuration by generating a preview list (not saved)
 */
export const testConfig = async (config: RandomizationConfig): Promise<{
  success: boolean;
  preview: { sequence: number; groupId: number; groupName: string; block: number; stratum: string }[];
  stats: { groupId: number; groupName: string; count: number; percentage: number }[];
  message?: string;
}> => {
  try {
    const groupIds = Object.keys(config.allocationRatios).map(Number);
    if (groupIds.length < 2) {
      return { success: false, preview: [], stats: [], message: 'Need at least 2 groups' };
    }

    // Look up group names
    const groupNamesResult = await pool.query(
      'SELECT study_group_id, name FROM study_group WHERE study_group_id = ANY($1)',
      [groupIds]
    );
    const groupNames: Record<number, string> = {};
    groupNamesResult.rows.forEach((r: any) => { groupNames[r.study_group_id] = r.name; });

    const testSeed = crypto.randomBytes(32).toString('hex');
    const prng = new SeededPRNG(testSeed);

    const blockSizesList = config.blockSizesList && config.blockSizesList.length > 0
      ? config.blockSizesList
      : [config.blockSize];

    // Generate for first stratum only (preview)
    const previewSize = Math.min(config.totalSlots, 50); // Cap preview at 50
    const list = config.randomizationType === 'simple'
      ? Array.from({ length: previewSize }, (_, i) => {
          const totalRatio = groupIds.reduce((sum, gid) => sum + (config.allocationRatios[gid.toString()] || 1), 0);
          let rand = prng.next() * totalRatio;
          let selectedGroup = groupIds[0];
          for (const gid of groupIds) {
            rand -= (config.allocationRatios[gid.toString()] || 1);
            if (rand <= 0) { selectedGroup = gid; break; }
          }
          return { groupId: selectedGroup, blockNumber: 0 };
        })
      : generateBlockList(prng, groupIds, config.allocationRatios, config.blockSize, config.blockSizeVaried, blockSizesList, previewSize);

    const preview = list.map((entry, i) => ({
      sequence: i + 1,
      groupId: entry.groupId,
      groupName: groupNames[entry.groupId] || `Group ${entry.groupId}`,
      block: entry.blockNumber,
      stratum: 'default'
    }));

    // Calculate stats
    const counts: Record<number, number> = {};
    list.forEach(e => { counts[e.groupId] = (counts[e.groupId] || 0) + 1; });

    const stats = groupIds.map(gid => ({
      groupId: gid,
      groupName: groupNames[gid] || `Group ${gid}`,
      count: counts[gid] || 0,
      percentage: Math.round(((counts[gid] || 0) / list.length) * 100)
    }));

    return { success: true, preview, stats };
  } catch (error: any) {
    logger.error('Failed to test config', { error: error.message });
    return { success: false, preview: [], stats: [], message: error.message };
  }
};
