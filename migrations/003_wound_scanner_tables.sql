-- WoundScanner Integration Database Schema
-- Creates tables for wound capture sessions, images, measurements, and audit trail
-- 21 CFR Part 11 Compliant

-- ============================================================================
-- CUSTOM TYPES
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM (
    'draft',
    'captured', 
    'signed',
    'submitted',
    'confirmed',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE capture_source AS ENUM (
    'ios_app',
    'app_clip',
    'web'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE calibration_method AS ENUM (
    'manual',
    'coin',
    'ruler',
    'credit_card',
    'lidar',
    'arkit'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE signature_meaning AS ENUM (
    'AUTHORSHIP',
    'APPROVAL',
    'REVIEW',
    'WITNESSING',
    'VERIFICATION'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE signature_auth_method AS ENUM (
    'BIOMETRIC',
    'PASSWORD',
    'MFA'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE storage_type AS ENUM (
    's3',
    'postgres_lo',
    'local'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_severity AS ENUM (
    'INFO',
    'WARNING',
    'ERROR',
    'CRITICAL'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- DEVICES TABLE (Track iOS devices)
-- ============================================================================

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(255) UNIQUE NOT NULL,
  model VARCHAR(100),
  os_version VARCHAR(50),
  app_version VARCHAR(50),
  push_token TEXT,
  user_id VARCHAR(50),
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

-- ============================================================================
-- WOUND SESSIONS TABLE (Main capture sessions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wound_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id VARCHAR(100) NOT NULL,
  template_id VARCHAR(255) NOT NULL,
  study_id VARCHAR(100),
  study_event_id VARCHAR(100),
  site_id VARCHAR(100),
  device_id VARCHAR(255),
  source capture_source DEFAULT 'ios_app',
  status session_status DEFAULT 'draft',
  created_by_user_id VARCHAR(100) NOT NULL,
  created_by_user_name VARCHAR(255) NOT NULL,
  submitted_by_user_id VARCHAR(100),
  submitted_by_user_name VARCHAR(255),
  libreclinica_id VARCHAR(100),
  study_event_data_id VARCHAR(100),
  item_data_id VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  captured_at TIMESTAMP WITH TIME ZONE,
  signed_at TIMESTAMP WITH TIME ZONE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  data_hash VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_wound_sessions_patient_id ON wound_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_wound_sessions_status ON wound_sessions(status);
CREATE INDEX IF NOT EXISTS idx_wound_sessions_created_at ON wound_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wound_sessions_libreclinica_id ON wound_sessions(libreclinica_id);
CREATE INDEX IF NOT EXISTS idx_wound_sessions_study_id ON wound_sessions(study_id);

-- ============================================================================
-- WOUND IMAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS wound_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES wound_sessions(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) DEFAULT 'image/jpeg',
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  storage_type storage_type DEFAULT 's3',
  hash VARCHAR(64) NOT NULL,
  hash_verified BOOLEAN DEFAULT false,
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  upload_completed_at TIMESTAMP WITH TIME ZONE,
  quality_score DECIMAL(5,2),
  quality_issues JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wound_images_session_id ON wound_images(session_id);
CREATE INDEX IF NOT EXISTS idx_wound_images_hash ON wound_images(hash);

-- ============================================================================
-- WOUND MEASUREMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS wound_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES wound_sessions(id) ON DELETE CASCADE,
  image_id UUID REFERENCES wound_images(id),
  area_cm2 DECIMAL(10,4) NOT NULL,
  perimeter_cm DECIMAL(10,4) NOT NULL,
  max_length_cm DECIMAL(10,4) NOT NULL,
  max_width_cm DECIMAL(10,4) NOT NULL,
  max_depth_cm DECIMAL(10,4),
  volume_cm3 DECIMAL(10,4),
  boundary_points JSONB NOT NULL,
  point_count INTEGER NOT NULL,
  calibration_method calibration_method NOT NULL,
  pixels_per_cm DECIMAL(10,4) NOT NULL,
  data_hash VARCHAR(64) NOT NULL,
  notes TEXT,
  measured_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wound_measurements_session_id ON wound_measurements(session_id);
CREATE INDEX IF NOT EXISTS idx_wound_measurements_measured_at ON wound_measurements(measured_at DESC);

-- ============================================================================
-- ELECTRONIC SIGNATURES TABLE (21 CFR Part 11)
-- ============================================================================

CREATE TABLE IF NOT EXISTS electronic_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES wound_sessions(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  user_role VARCHAR(100) NOT NULL,
  meaning signature_meaning NOT NULL,
  manifestation TEXT NOT NULL,
  data_hash VARCHAR(64) NOT NULL,
  signature_value TEXT NOT NULL,
  auth_method signature_auth_method NOT NULL,
  device_id VARCHAR(255),
  signed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_valid BOOLEAN DEFAULT true,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_electronic_signatures_session_id ON electronic_signatures(session_id);
CREATE INDEX IF NOT EXISTS idx_electronic_signatures_user_id ON electronic_signatures(user_id);
CREATE INDEX IF NOT EXISTS idx_electronic_signatures_signed_at ON electronic_signatures(signed_at DESC);

-- ============================================================================
-- AUDIT TRAIL TABLE (21 CFR Part 11 Compliant)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(100) NOT NULL,
  category VARCHAR(50) DEFAULT 'WOUND_CAPTURE',
  severity audit_severity DEFAULT 'INFO',
  user_id VARCHAR(100),
  user_name VARCHAR(255),
  device_id VARCHAR(255),
  patient_id VARCHAR(100),
  session_id UUID,
  details JSONB NOT NULL DEFAULT '{}',
  checksum VARCHAR(64) NOT NULL,
  previous_checksum VARCHAR(64),
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  source VARCHAR(50) DEFAULT 'backend',
  ip_address VARCHAR(45),
  received_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Optimized indexes for audit trail queries
CREATE INDEX IF NOT EXISTS idx_audit_trail_action ON audit_trail(action);
CREATE INDEX IF NOT EXISTS idx_audit_trail_user_id ON audit_trail(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_session_id ON audit_trail(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_patient_id ON audit_trail(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_timestamp ON audit_trail(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created_at ON audit_trail(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_category ON audit_trail(category);

-- ============================================================================
-- SYNC QUEUE TABLE (Offline support)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(255) NOT NULL,
  local_session_id VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 5,
  status VARCHAR(50) DEFAULT 'pending',
  error_message TEXT,
  queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_device_id ON sync_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_queued_at ON sync_queue(queued_at);

-- ============================================================================
-- TEMPLATE CACHE TABLE (Cache LibreClinica CRF templates)
-- ============================================================================

CREATE TABLE IF NOT EXISTS template_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(500) NOT NULL,
  version VARCHAR(50) NOT NULL,
  definition JSONB NOT NULL,
  libreclinica_crf_id INTEGER,
  libreclinica_version_id INTEGER,
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_cache_template_id ON template_cache(template_id);
CREATE INDEX IF NOT EXISTS idx_template_cache_is_active ON template_cache(is_active);

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Patient wound summary
CREATE OR REPLACE VIEW v_patient_wound_summary AS
SELECT 
  ws.patient_id,
  COUNT(DISTINCT ws.id) as total_sessions,
  COUNT(DISTINCT CASE WHEN ws.status = 'submitted' THEN ws.id END) as submitted_sessions,
  MAX(ws.created_at) as last_capture_at,
  AVG(wm.area_cm2) as avg_area_cm2,
  MIN(wm.area_cm2) as min_area_cm2,
  MAX(wm.area_cm2) as max_area_cm2
FROM wound_sessions ws
LEFT JOIN wound_measurements wm ON ws.id = wm.session_id
GROUP BY ws.patient_id;

-- View: Recent wound captures
CREATE OR REPLACE VIEW v_recent_wound_captures AS
SELECT 
  ws.id,
  ws.patient_id,
  ws.template_id,
  ws.status,
  ws.source,
  ws.created_by_user_name,
  ws.created_at,
  ws.captured_at,
  ws.submitted_at,
  wm.area_cm2,
  wm.perimeter_cm,
  wm.max_length_cm,
  wm.max_width_cm,
  wm.calibration_method
FROM wound_sessions ws
LEFT JOIN LATERAL (
  SELECT * FROM wound_measurements 
  WHERE session_id = ws.id 
  ORDER BY measured_at DESC 
  LIMIT 1
) wm ON true
ORDER BY ws.created_at DESC;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_wound_sessions_updated_at ON wound_sessions;
CREATE TRIGGER update_wound_sessions_updated_at 
  BEFORE UPDATE ON wound_sessions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_devices_updated_at ON devices;
CREATE TRIGGER update_devices_updated_at 
  BEFORE UPDATE ON devices 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_template_cache_updated_at ON template_cache;
CREATE TRIGGER update_template_cache_updated_at 
  BEFORE UPDATE ON template_cache 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- GRANTS (Adjust based on your user setup)
-- ============================================================================

-- Grant permissions to the libreclinica user
DO $$ 
BEGIN
  -- Check if clinica user exists, grant permissions if so
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinica') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clinica;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clinica;
  END IF;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE wound_sessions IS 'Main wound capture session records';
COMMENT ON TABLE wound_images IS 'Captured wound images with storage references';
COMMENT ON TABLE wound_measurements IS 'Calculated wound measurements from captured images';
COMMENT ON TABLE electronic_signatures IS '21 CFR Part 11 compliant electronic signatures';
COMMENT ON TABLE audit_trail IS 'Hash-chained audit trail for compliance';
COMMENT ON TABLE devices IS 'Registered iOS devices for capture';
COMMENT ON TABLE sync_queue IS 'Offline sync queue for mobile devices';
COMMENT ON TABLE template_cache IS 'Cached LibreClinica CRF templates for mobile use';

