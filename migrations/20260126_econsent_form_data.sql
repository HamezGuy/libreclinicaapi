-- Migration: eConsent Form Data Support
-- Created: January 26, 2026
-- Description: Add form_data and template_id columns for storing form builder data with consent

BEGIN;

-- Add form_data column to store template form responses
ALTER TABLE acc_subject_consent 
ADD COLUMN IF NOT EXISTS form_data JSONB;

-- Add template_id to track which form template was used
ALTER TABLE acc_subject_consent 
ADD COLUMN IF NOT EXISTS template_id INTEGER;

-- Create index for template_id lookups
CREATE INDEX IF NOT EXISTS idx_subject_consent_template 
ON acc_subject_consent(template_id);

-- Add comment explaining the columns
COMMENT ON COLUMN acc_subject_consent.form_data IS 'JSON data from form builder template fields';
COMMENT ON COLUMN acc_subject_consent.template_id IS 'Reference to the form template (crf) used for this consent';

COMMIT;
