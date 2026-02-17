-- Migration: Backfill visits and form copies for patients missing them
-- Date: 2026-02-17
-- Description:
--   Patients created via seed data (subjects 11-30) don't have study_event
--   records or event_crf records. This script creates them to match the
--   study_event_definition setup.
--
--   For each patient that has 0 study_events:
--     1. Create a study_event for each study_event_definition in their study
--     2. Create an event_crf for each form (event_definition_crf) assigned to that visit
--
--   This ensures all patients have the same visits and forms as the study template.

DO $$
DECLARE
  v_subject RECORD;
  v_event_def RECORD;
  v_crf RECORD;
  v_study_event_id INTEGER;
  v_event_crf_id INTEGER;
  v_crf_version_id INTEGER;
  v_events_created INTEGER := 0;
  v_forms_created INTEGER := 0;
  v_subjects_fixed INTEGER := 0;
BEGIN
  -- Find all subjects that have NO study_events
  FOR v_subject IN
    SELECT ss.study_subject_id, ss.study_id, ss.label, ss.enrollment_date, ss.owner_id
    FROM study_subject ss
    WHERE ss.status_id = 1
      AND NOT EXISTS (
        SELECT 1 FROM study_event se
        WHERE se.study_subject_id = ss.study_subject_id
      )
    ORDER BY ss.study_subject_id
  LOOP
    RAISE NOTICE 'Backfilling visits for subject % (study_subject_id=%)', v_subject.label, v_subject.study_subject_id;
    
    -- Get all study_event_definitions for this subject's study
    FOR v_event_def IN
      SELECT sed.study_event_definition_id, sed.name, sed.ordinal, sed.type
      FROM study_event_definition sed
      WHERE sed.study_id = v_subject.study_id
        AND sed.status_id = 1
        AND sed.type != 'unscheduled'  -- Don't auto-create unscheduled visit types
      ORDER BY sed.ordinal
    LOOP
      -- Create the study_event (visit instance) for this patient
      INSERT INTO study_event (
        study_event_definition_id,
        study_subject_id,
        location,
        sample_ordinal,
        date_start,
        date_end,
        owner_id,
        status_id,
        subject_event_status_id,
        date_created
      ) VALUES (
        v_event_def.study_event_definition_id,
        v_subject.study_subject_id,
        '',
        1,
        COALESCE(v_subject.enrollment_date, CURRENT_DATE) + ((v_event_def.ordinal - 1) * 7),
        COALESCE(v_subject.enrollment_date, CURRENT_DATE) + ((v_event_def.ordinal - 1) * 7),
        COALESCE(v_subject.owner_id, 1),
        1,
        (SELECT subject_event_status_id FROM subject_event_status WHERE name = 'scheduled' LIMIT 1),
        NOW()
      )
      RETURNING study_event_id INTO v_study_event_id;
      
      v_events_created := v_events_created + 1;
      
      -- Create event_crf records for each form assigned to this visit type
      FOR v_crf IN
        SELECT edc.crf_id, edc.default_version_id, c.name as crf_name
        FROM event_definition_crf edc
        INNER JOIN crf c ON edc.crf_id = c.crf_id
        WHERE edc.study_event_definition_id = v_event_def.study_event_definition_id
          AND edc.status_id = 1
        ORDER BY edc.ordinal
      LOOP
        -- Determine the CRF version to use
        v_crf_version_id := v_crf.default_version_id;
        IF v_crf_version_id IS NULL THEN
          SELECT crf_version_id INTO v_crf_version_id
          FROM crf_version
          WHERE crf_id = v_crf.crf_id AND status_id = 1
          ORDER BY crf_version_id DESC
          LIMIT 1;
        END IF;
        
        IF v_crf_version_id IS NOT NULL THEN
          -- Create the event_crf (patient's form instance)
          INSERT INTO event_crf (
            study_event_id,
            crf_version_id,
            study_subject_id,
            completion_status_id,
            status_id,
            owner_id,
            date_created
          ) VALUES (
            v_study_event_id,
            v_crf_version_id,
            v_subject.study_subject_id,
            1,  -- not_started
            1,  -- available
            COALESCE(v_subject.owner_id, 1),
            NOW()
          )
          RETURNING event_crf_id INTO v_event_crf_id;
          
          v_forms_created := v_forms_created + 1;
        ELSE
          RAISE NOTICE '  WARNING: No version found for form "%" (crf_id=%)', v_crf.crf_name, v_crf.crf_id;
        END IF;
      END LOOP;
    END LOOP;
    
    v_subjects_fixed := v_subjects_fixed + 1;
  END LOOP;
  
  RAISE NOTICE '=== BACKFILL COMPLETE ===';
  RAISE NOTICE 'Subjects fixed: %', v_subjects_fixed;
  RAISE NOTICE 'Visits created: %', v_events_created;
  RAISE NOTICE 'Form copies created: %', v_forms_created;
END $$;
