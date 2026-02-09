-- =============================================================================
-- Migration: Randomization Engine Extension Tables
-- Date: 2025-02-09
-- 
-- These are EXTENSION tables (acc_* prefix) that add sealed-list randomization
-- capabilities ON TOP OF the native LibreClinica tables:
--   - study_group_class  (native - treatment arm classes)
--   - study_group        (native - individual groups/arms)
--   - subject_group_map  (native - subject-to-group assignments)
--
-- The engine stores config + pre-generated lists in acc_* tables,
-- but the final subject assignment always writes to native subject_group_map.
--
-- This does NOT modify any existing native LibreClinica tables.
-- =============================================================================

-- 1. Randomization Configuration (one per study)
CREATE TABLE IF NOT EXISTS acc_randomization_config (
    config_id               SERIAL PRIMARY KEY,
    study_id                INTEGER NOT NULL REFERENCES study(study_id),
    name                    VARCHAR(255) NOT NULL,
    description             TEXT,
    randomization_type      VARCHAR(50) NOT NULL DEFAULT 'block',      -- simple, block, stratified
    blinding_level          VARCHAR(50) NOT NULL DEFAULT 'double_blind', -- open_label, single_blind, double_blind, triple_blind
    block_size              INTEGER NOT NULL DEFAULT 4,
    block_size_varied       BOOLEAN NOT NULL DEFAULT false,
    block_sizes_list        TEXT,                                        -- JSON array e.g. [4,6,8]
    allocation_ratios       TEXT NOT NULL,                               -- JSON object e.g. {"1":1,"2":1}
    stratification_factors  TEXT,                                        -- JSON array of factors
    study_group_class_id    INTEGER REFERENCES study_group_class(study_group_class_id),
    seed                    VARCHAR(128),                                -- Crypto seed for reproducibility
    total_slots             INTEGER NOT NULL DEFAULT 100,
    is_active               BOOLEAN NOT NULL DEFAULT false,
    is_locked               BOOLEAN NOT NULL DEFAULT false,
    drug_kit_management     BOOLEAN NOT NULL DEFAULT false,
    drug_kit_prefix         VARCHAR(50),
    site_specific           BOOLEAN NOT NULL DEFAULT false,
    created_by              INTEGER REFERENCES user_account(user_id),
    date_created            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    date_updated            TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_acc_rand_config_study ON acc_randomization_config(study_id);

-- 2. Sealed Randomization List (pre-generated slots)
CREATE TABLE IF NOT EXISTS acc_randomization_list (
    list_entry_id           SERIAL PRIMARY KEY,
    config_id               INTEGER NOT NULL REFERENCES acc_randomization_config(config_id),
    sequence_number         INTEGER NOT NULL,
    study_group_id          INTEGER NOT NULL REFERENCES study_group(study_group_id),
    stratum_key             VARCHAR(500) NOT NULL DEFAULT 'default',
    site_id                 INTEGER,
    block_number            INTEGER NOT NULL DEFAULT 0,
    is_used                 BOOLEAN NOT NULL DEFAULT false,
    used_by_subject_id      INTEGER REFERENCES study_subject(study_subject_id),
    used_at                 TIMESTAMP WITH TIME ZONE,
    used_by_user_id         INTEGER REFERENCES user_account(user_id),
    randomization_number    VARCHAR(50),
    date_created            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acc_rand_list_config ON acc_randomization_list(config_id);
CREATE INDEX IF NOT EXISTS idx_acc_rand_list_unused ON acc_randomization_list(config_id, stratum_key, is_used) WHERE NOT is_used;
CREATE INDEX IF NOT EXISTS idx_acc_rand_list_subject ON acc_randomization_list(used_by_subject_id) WHERE used_by_subject_id IS NOT NULL;
