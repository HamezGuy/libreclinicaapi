-- Migration: Visits & Forms Fix
-- Date: 2026-02-18
-- Description:
--   1. Adds missing columns to study_event (scheduled_date, is_unscheduled, estimated_start/end)
--   2. Adds estimated duration fields to study_event_definition
--   3. Creates patient_event_form table for patient-specific form copies with JSONB snapshots
--   4. Adds subject_event_status rows if missing

-- =============================================
-- 1. Add missing columns to study_event
-- =============================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='study_event' AND column_name='scheduled_date') THEN
    ALTER TABLE study_event ADD COLUMN scheduled_date TIMESTAMP;
    RAISE NOTICE 'Added scheduled_date to study_event';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='study_event' AND column_name='is_unscheduled') THEN
    ALTER TABLE study_event ADD COLUMN is_unscheduled BOOLEAN DEFAULT false;
    RAISE NOTICE 'Added is_unscheduled to study_event';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='study_event' AND column_name='estimated_start') THEN
    ALTER TABLE study_event ADD COLUMN estimated_start TIMESTAMP;
    RAISE NOTICE 'Added estimated_start to study_event';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='study_event' AND column_name='estimated_end') THEN
    ALTER TABLE study_event ADD COLUMN estimated_end TIMESTAMP;
    RAISE NOTICE 'Added estimated_end to study_event';
  END IF;
END $$;

-- =============================================
-- 2. Add estimated duration to study_event_definition
-- =============================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='study_event_definition' AND column_name='estimated_duration_hours') THEN
    ALTER TABLE study_event_definition ADD COLUMN estimated_duration_hours NUMERIC(5,2);
    RAISE NOTICE 'Added estimated_duration_hours to study_event_definition';
  END IF;
END $$;

-- =============================================
-- 3. Create patient_event_form table
-- =============================================
CREATE TABLE IF NOT EXISTS patient_event_form (
  patient_event_form_id SERIAL PRIMARY KEY,
  study_event_id INTEGER NOT NULL REFERENCES study_event(study_event_id),
  event_crf_id INTEGER REFERENCES event_crf(event_crf_id),
  crf_id INTEGER NOT NULL,
  crf_version_id INTEGER NOT NULL,
  study_subject_id INTEGER NOT NULL REFERENCES study_subject(study_subject_id),
  form_name VARCHAR(255) NOT NULL,
  form_structure JSONB NOT NULL DEFAULT '{}',
  form_data JSONB NOT NULL DEFAULT '{}',
  completion_status VARCHAR(30) NOT NULL DEFAULT 'not_started',
  is_locked BOOLEAN NOT NULL DEFAULT false,
  is_frozen BOOLEAN NOT NULL DEFAULT false,
  sdv_status BOOLEAN NOT NULL DEFAULT false,
  ordinal INTEGER DEFAULT 1,
  date_created TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  date_updated TIMESTAMP WITH TIME ZONE,
  created_by INTEGER,
  updated_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pef_study_event ON patient_event_form(study_event_id);
CREATE INDEX IF NOT EXISTS idx_pef_subject ON patient_event_form(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_pef_event_crf ON patient_event_form(event_crf_id);

-- =============================================
-- 4. Ensure subject_event_status rows exist
-- =============================================
INSERT INTO subject_event_status (subject_event_status_id, name, description)
VALUES
  (1, 'scheduled', 'Event is scheduled'),
  (2, 'not_scheduled', 'Event is not yet scheduled'),
  (3, 'data_entry_started', 'Data entry has started'),
  (4, 'completed', 'Event is completed'),
  (5, 'stopped', 'Event was stopped'),
  (6, 'skipped', 'Event was skipped'),
  (7, 'signed', 'Event is signed'),
  (8, 'locked', 'Event is locked')
ON CONFLICT (subject_event_status_id) DO NOTHING;
