-- Migration: Make version_id nullable on acc_subject_consent
-- Created: March 30, 2026
-- Description: Allow consent records to be saved without a formal consent
--   document/version. This supports the common workflow where consent is
--   captured (signature + name) before a study has configured formal
--   consent documents.

BEGIN;

ALTER TABLE acc_subject_consent
  ALTER COLUMN version_id DROP NOT NULL;

COMMIT;
