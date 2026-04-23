-- Migration: Create validation_rules table (previously managed at runtime)
-- This migration captures the full table schema that was previously created
-- by validation-rules.service.ts initializeValidationRulesTable()

CREATE TABLE IF NOT EXISTS validation_rules (
  validation_rule_id SERIAL PRIMARY KEY,
  crf_id INTEGER NOT NULL REFERENCES crf(crf_id),
  crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
  item_id INTEGER REFERENCES item(item_id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  rule_type VARCHAR(50) NOT NULL,
  field_path VARCHAR(255),
  severity VARCHAR(20) NOT NULL DEFAULT 'warning',
  error_message TEXT,
  warning_message TEXT,
  active BOOLEAN DEFAULT true,
  min_value NUMERIC,
  max_value NUMERIC,
  pattern TEXT,
  format_type VARCHAR(50),
  operator VARCHAR(30),
  compare_field_path VARCHAR(255),
  compare_value TEXT,
  custom_expression TEXT,
  bp_systolic_min NUMERIC,
  bp_systolic_max NUMERIC,
  bp_diastolic_min NUMERIC,
  bp_diastolic_max NUMERIC,
  table_cell_target JSONB,
  date_created TIMESTAMP DEFAULT NOW(),
  date_updated TIMESTAMP DEFAULT NOW(),
  owner_id INTEGER,
  update_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_validation_rules_crf ON validation_rules(crf_id);
CREATE INDEX IF NOT EXISTS idx_validation_rules_crf_version ON validation_rules(crf_version_id);
CREATE INDEX IF NOT EXISTS idx_validation_rules_item ON validation_rules(item_id);
CREATE INDEX IF NOT EXISTS idx_validation_rules_active ON validation_rules(active);
