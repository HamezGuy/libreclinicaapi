-- Migration: Add facility_address column and unscheduled visit support
-- Date: 2026-02-14
-- Description: 
--   1. Adds facility_address column to study table for full street address
--   2. Adds scheduled_date column to study_event for unscheduled visit date tracking

-- =============================================
-- 1. Add facility_address to study table
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'study' AND column_name = 'facility_address'
  ) THEN
    ALTER TABLE study ADD COLUMN facility_address VARCHAR(1000);
    RAISE NOTICE 'Added facility_address column to study table';
  ELSE
    RAISE NOTICE 'facility_address column already exists in study table';
  END IF;
END $$;

-- =============================================
-- 2. Add scheduled_date to study_event table
--    This allows unscheduled visits to have an explicit
--    date set before data entry begins, separate from
--    date_start which is set when the visit actually occurs.
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'study_event' AND column_name = 'scheduled_date'
  ) THEN
    ALTER TABLE study_event ADD COLUMN scheduled_date TIMESTAMP WITH TIME ZONE;
    RAISE NOTICE 'Added scheduled_date column to study_event table';
  ELSE
    RAISE NOTICE 'scheduled_date column already exists in study_event table';
  END IF;
END $$;

-- =============================================
-- 3. Add is_unscheduled flag to study_event table
--    Tracks whether this event instance was created
--    as an unscheduled (ad-hoc) visit, regardless of
--    the definition type.
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'study_event' AND column_name = 'is_unscheduled'
  ) THEN
    ALTER TABLE study_event ADD COLUMN is_unscheduled BOOLEAN DEFAULT FALSE;
    RAISE NOTICE 'Added is_unscheduled column to study_event table';
  ELSE
    RAISE NOTICE 'is_unscheduled column already exists in study_event table';
  END IF;
END $$;

-- Index for efficient chronological queries mixing scheduled and unscheduled visits
CREATE INDEX IF NOT EXISTS idx_study_event_scheduled_date 
  ON study_event (study_subject_id, scheduled_date) 
  WHERE scheduled_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_study_event_unscheduled 
  ON study_event (study_subject_id, is_unscheduled) 
  WHERE is_unscheduled = TRUE;
