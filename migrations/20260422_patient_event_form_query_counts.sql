-- Migration: Add query count columns to patient_event_form
-- These columns are referenced by updateFormQueryCounts in query.service.ts
-- but were missing from the original table creation migration.

ALTER TABLE patient_event_form ADD COLUMN IF NOT EXISTS open_query_count INTEGER DEFAULT 0;
ALTER TABLE patient_event_form ADD COLUMN IF NOT EXISTS overdue_query_count INTEGER DEFAULT 0;
ALTER TABLE patient_event_form ADD COLUMN IF NOT EXISTS closed_query_count INTEGER DEFAULT 0;
