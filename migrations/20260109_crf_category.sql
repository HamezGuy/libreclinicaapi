-- Migration: Add category column to CRF table
-- Date: 2026-01-09
-- Purpose: Store form category directly on CRF for proper persistence and retrieval

-- Add category column to CRF table
ALTER TABLE crf ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'other';

-- Update existing CRFs to use section label as category if available
UPDATE crf c
SET category = COALESCE(
    (SELECT s.label 
     FROM section s 
     INNER JOIN crf_version cv ON s.crf_version_id = cv.crf_version_id 
     WHERE cv.crf_id = c.crf_id 
     ORDER BY cv.crf_version_id DESC 
     LIMIT 1),
    'other'
)
WHERE category IS NULL OR category = 'other';

-- Create index for category lookups
CREATE INDEX IF NOT EXISTS idx_crf_category ON crf(category);

