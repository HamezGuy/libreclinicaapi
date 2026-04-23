-- Migration: Add structured cell_target JSONB columns to query mapping tables
-- Replaces regex-based parsing of column_name string paths with a structured
-- object that stores table field path, column ID, row identifier, and type
-- as separate fields — immune to user-created names containing dots or brackets.
-- Date: 2026-04-22

-- ─── Add cell_target to dn_item_data_map ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dn_item_data_map' AND column_name = 'cell_target'
  ) THEN
    ALTER TABLE dn_item_data_map ADD COLUMN cell_target JSONB;
    COMMENT ON COLUMN dn_item_data_map.cell_target IS
      'Structured cell targeting for table/question_table queries. '
      'Shape: { tableFieldPath, tableItemId, columnId, columnType, rowIndex, rowId, allRows, tableType }. '
      'Replaces regex parsing of column_name for cell-level logic.';
    RAISE NOTICE 'Added cell_target JSONB column to dn_item_data_map';
  ELSE
    RAISE NOTICE 'cell_target column already exists on dn_item_data_map — skipping';
  END IF;
END $$;

-- ─── Add cell_target to dn_event_crf_map ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dn_event_crf_map' AND column_name = 'cell_target'
  ) THEN
    ALTER TABLE dn_event_crf_map ADD COLUMN cell_target JSONB;
    COMMENT ON COLUMN dn_event_crf_map.cell_target IS
      'Structured cell targeting for table/question_table queries (event-level linkage). '
      'Same shape as dn_item_data_map.cell_target.';
    RAISE NOTICE 'Added cell_target JSONB column to dn_event_crf_map';
  ELSE
    RAISE NOTICE 'cell_target column already exists on dn_event_crf_map — skipping';
  END IF;
END $$;

-- ─── Backfill: parse existing column_name cell paths into cell_target ────────
-- This is a ONE-TIME regex parse. After this migration, no regex is used for
-- cell path logic — the structured cell_target column is the source of truth.

-- Data table paths: "fieldKey[rowIndex].colKey"
UPDATE dn_item_data_map
SET cell_target = jsonb_build_object(
  'tableFieldPath', (regexp_match(column_name, '^(.+)\[(\d+)\]\.(.+)$'))[1],
  'columnId',       (regexp_match(column_name, '^(.+)\[(\d+)\]\.(.+)$'))[3],
  'rowIndex',       ((regexp_match(column_name, '^(.+)\[(\d+)\]\.(.+)$'))[2])::int,
  'allRows',        false,
  'tableType',      'table'
)
WHERE cell_target IS NULL
  AND column_name ~ '^.+\[\d+\]\..+$';

-- Data table wildcard paths: "fieldKey[*].colKey"
UPDATE dn_item_data_map
SET cell_target = jsonb_build_object(
  'tableFieldPath', (regexp_match(column_name, '^(.+)\[\*\]\.(.+)$'))[1],
  'columnId',       (regexp_match(column_name, '^(.+)\[\*\]\.(.+)$'))[2],
  'allRows',        true,
  'tableType',      'table'
)
WHERE cell_target IS NULL
  AND column_name ~ '^.+\[\*\]\..+$';

-- Question table paths: "fieldKey.rowId.colId" (3+ dot-separated segments, no brackets)
-- Only backfill rows that look like question table paths AND aren't plain "value"
UPDATE dn_item_data_map
SET cell_target = jsonb_build_object(
  'tableFieldPath', split_part(column_name, '.', 1),
  'columnId',       split_part(column_name, '.', 3),
  'rowId',          split_part(column_name, '.', 2),
  'allRows',        split_part(column_name, '.', 2) = '*',
  'tableType',      'question_table'
)
WHERE cell_target IS NULL
  AND column_name IS NOT NULL
  AND column_name NOT IN ('value', '')
  AND column_name NOT LIKE '%[%'
  AND array_length(string_to_array(column_name, '.'), 1) = 3;

-- Repeat for dn_event_crf_map (same patterns)
UPDATE dn_event_crf_map
SET cell_target = jsonb_build_object(
  'tableFieldPath', (regexp_match(column_name, '^(.+)\[(\d+)\]\.(.+)$'))[1],
  'columnId',       (regexp_match(column_name, '^(.+)\[(\d+)\]\.(.+)$'))[3],
  'rowIndex',       ((regexp_match(column_name, '^(.+)\[(\d+)\]\.(.+)$'))[2])::int,
  'allRows',        false,
  'tableType',      'table'
)
WHERE cell_target IS NULL
  AND column_name ~ '^.+\[\d+\]\..+$';

UPDATE dn_event_crf_map
SET cell_target = jsonb_build_object(
  'tableFieldPath', (regexp_match(column_name, '^(.+)\[\*\]\.(.+)$'))[1],
  'columnId',       (regexp_match(column_name, '^(.+)\[\*\]\.(.+)$'))[2],
  'allRows',        true,
  'tableType',      'table'
)
WHERE cell_target IS NULL
  AND column_name ~ '^.+\[\*\]\..+$';

UPDATE dn_event_crf_map
SET cell_target = jsonb_build_object(
  'tableFieldPath', split_part(column_name, '.', 1),
  'columnId',       split_part(column_name, '.', 3),
  'rowId',          split_part(column_name, '.', 2),
  'allRows',        split_part(column_name, '.', 2) = '*',
  'tableType',      'question_table'
)
WHERE cell_target IS NULL
  AND column_name IS NOT NULL
  AND column_name NOT IN ('value', '')
  AND column_name NOT LIKE '%[%'
  AND array_length(string_to_array(column_name, '.'), 1) = 3;

-- Log backfill results
DO $$
DECLARE
  item_count INT;
  ecrf_count INT;
BEGIN
  SELECT COUNT(*) INTO item_count FROM dn_item_data_map WHERE cell_target IS NOT NULL;
  SELECT COUNT(*) INTO ecrf_count FROM dn_event_crf_map WHERE cell_target IS NOT NULL;
  RAISE NOTICE 'Backfill complete: % dn_item_data_map rows, % dn_event_crf_map rows with cell_target', item_count, ecrf_count;
END $$;
