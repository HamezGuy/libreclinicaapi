-- Migration: Study Redesign - Enhanced fields, flexible group types
-- Date: 2026-02-17
-- Description:
--   1. Adds regulatory fields to study table (therapeutic_area, indication, nct_number, etc.)
--   2. Adds protocol versioning fields (protocol_version, protocol_amendment_number)
--   3. Adds timeline milestone dates (fpfv_date, lpfv_date, lplv_date, database_lock_date)
--   4. Adds operational fields (study_acronym, sdv_requirement)
--   5. Adds custom_type_name to study_group_class for flexible group class types
--   6. Inserts new group_class_types rows (Custom, Cohort, Stratification Factor, Dose Group)

-- =============================================
-- 1. Add regulatory fields to study table
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'therapeutic_area'
  ) THEN
    ALTER TABLE study ADD COLUMN therapeutic_area VARCHAR(255);
    RAISE NOTICE 'Added therapeutic_area column to study table';
  ELSE
    RAISE NOTICE 'therapeutic_area column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'indication'
  ) THEN
    ALTER TABLE study ADD COLUMN indication VARCHAR(255);
    RAISE NOTICE 'Added indication column to study table';
  ELSE
    RAISE NOTICE 'indication column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'nct_number'
  ) THEN
    ALTER TABLE study ADD COLUMN nct_number VARCHAR(30);
    RAISE NOTICE 'Added nct_number column to study table';
  ELSE
    RAISE NOTICE 'nct_number column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'irb_number'
  ) THEN
    ALTER TABLE study ADD COLUMN irb_number VARCHAR(255);
    RAISE NOTICE 'Added irb_number column to study table';
  ELSE
    RAISE NOTICE 'irb_number column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'regulatory_authority'
  ) THEN
    ALTER TABLE study ADD COLUMN regulatory_authority VARCHAR(255);
    RAISE NOTICE 'Added regulatory_authority column to study table';
  ELSE
    RAISE NOTICE 'regulatory_authority column already exists in study table';
  END IF;
END $$;

-- =============================================
-- 2. Add protocol versioning fields
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'protocol_version'
  ) THEN
    ALTER TABLE study ADD COLUMN protocol_version VARCHAR(30);
    RAISE NOTICE 'Added protocol_version column to study table';
  ELSE
    RAISE NOTICE 'protocol_version column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'protocol_amendment_number'
  ) THEN
    ALTER TABLE study ADD COLUMN protocol_amendment_number VARCHAR(30);
    RAISE NOTICE 'Added protocol_amendment_number column to study table';
  ELSE
    RAISE NOTICE 'protocol_amendment_number column already exists in study table';
  END IF;
END $$;

-- =============================================
-- 3. Add timeline milestone dates
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'fpfv_date'
  ) THEN
    ALTER TABLE study ADD COLUMN fpfv_date DATE;
    RAISE NOTICE 'Added fpfv_date column to study table';
  ELSE
    RAISE NOTICE 'fpfv_date column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'lpfv_date'
  ) THEN
    ALTER TABLE study ADD COLUMN lpfv_date DATE;
    RAISE NOTICE 'Added lpfv_date column to study table';
  ELSE
    RAISE NOTICE 'lpfv_date column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'lplv_date'
  ) THEN
    ALTER TABLE study ADD COLUMN lplv_date DATE;
    RAISE NOTICE 'Added lplv_date column to study table';
  ELSE
    RAISE NOTICE 'lplv_date column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'database_lock_date'
  ) THEN
    ALTER TABLE study ADD COLUMN database_lock_date DATE;
    RAISE NOTICE 'Added database_lock_date column to study table';
  ELSE
    RAISE NOTICE 'database_lock_date column already exists in study table';
  END IF;
END $$;

-- =============================================
-- 4. Add operational fields
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'study_acronym'
  ) THEN
    ALTER TABLE study ADD COLUMN study_acronym VARCHAR(64);
    RAISE NOTICE 'Added study_acronym column to study table';
  ELSE
    RAISE NOTICE 'study_acronym column already exists in study table';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'sdv_requirement'
  ) THEN
    ALTER TABLE study ADD COLUMN sdv_requirement VARCHAR(64);
    RAISE NOTICE 'Added sdv_requirement column to study table';
  ELSE
    RAISE NOTICE 'sdv_requirement column already exists in study table';
  END IF;
END $$;

-- =============================================
-- 5. Add custom_type_name to study_group_class
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study_group_class' AND column_name = 'custom_type_name'
  ) THEN
    ALTER TABLE study_group_class ADD COLUMN custom_type_name VARCHAR(255);
    RAISE NOTICE 'Added custom_type_name column to study_group_class table';
  ELSE
    RAISE NOTICE 'custom_type_name column already exists in study_group_class table';
  END IF;
END $$;

-- =============================================
-- 6. Insert new group_class_types rows
--    Existing: 1=Arm, 2=Family/Pedigree, 3=Demographic, 4=Other
--    New: 5=Custom, 6=Cohort, 7=Stratification Factor, 8=Dose Group
-- =============================================
INSERT INTO group_class_types (group_class_type_id, name, description)
VALUES
  (5, 'Custom', 'User-defined group class type'),
  (6, 'Cohort', 'Cohort grouping for dose escalation or enrollment waves'),
  (7, 'Stratification Factor', 'Stratification factors for randomization balancing'),
  (8, 'Dose Group', 'Dose-level grouping for dose-finding studies')
ON CONFLICT (group_class_type_id) DO NOTHING;
