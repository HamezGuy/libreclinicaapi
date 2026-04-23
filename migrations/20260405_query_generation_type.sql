-- Migration: Add generation_type column to discrepancy_note table
-- Tracks whether a query was created manually by a user or automatically by validation rules
-- Date: 2026-04-05

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discrepancy_note' AND column_name = 'generation_type'
  ) THEN
    ALTER TABLE discrepancy_note ADD COLUMN generation_type VARCHAR(20) DEFAULT 'manual';
    COMMENT ON COLUMN discrepancy_note.generation_type IS 'Query origin: manual (user-created) or automatic (validation rule)';
    RAISE NOTICE 'Added generation_type column to discrepancy_note';
  ELSE
    RAISE NOTICE 'generation_type column already exists — skipping';
  END IF;
END $$;

-- Backfill: mark existing Failed Validation Check queries (type_id=1) as automatic
UPDATE discrepancy_note
SET generation_type = 'automatic'
WHERE discrepancy_note_type_id = 1
  AND (generation_type IS NULL OR generation_type = 'manual');
