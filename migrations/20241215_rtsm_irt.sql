-- Migration: RTSM/IRT (Randomization and Trial Supply Management)
-- Created: December 15, 2024
-- Description: Create tables for investigational product and supply management

-- Up Migration
BEGIN;

-- Kit types (investigational product types)
CREATE TABLE IF NOT EXISTS acc_kit_type (
  kit_type_id SERIAL PRIMARY KEY,
  study_id INTEGER REFERENCES study(study_id) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  product_code VARCHAR(100),
  treatment_arm VARCHAR(100), -- Links to randomization arm
  storage_conditions VARCHAR(255), -- refrigerated, frozen, room_temp
  min_storage_temp NUMERIC, -- Celsius
  max_storage_temp NUMERIC, -- Celsius
  shelf_life_days INTEGER,
  units_per_kit INTEGER DEFAULT 1,
  kit_image_path VARCHAR(500),
  is_placebo BOOLEAN DEFAULT false,
  is_blinded BOOLEAN DEFAULT true,
  reorder_threshold INTEGER, -- Alert when inventory below this
  status VARCHAR(20) DEFAULT 'active', -- active, inactive
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(study_id, product_code)
);

-- Individual kits/units
CREATE TABLE IF NOT EXISTS acc_kit (
  kit_id SERIAL PRIMARY KEY,
  kit_type_id INTEGER REFERENCES acc_kit_type(kit_type_id) NOT NULL,
  kit_number VARCHAR(100) NOT NULL UNIQUE,
  batch_number VARCHAR(100),
  lot_number VARCHAR(100),
  
  -- Dates
  manufacture_date DATE,
  expiration_date DATE NOT NULL,
  received_date DATE,
  
  -- Current status and location
  status VARCHAR(30) DEFAULT 'available', -- available, reserved, dispensed, returned, damaged, expired, destroyed
  current_site_id INTEGER REFERENCES study(study_id), -- Site is child study
  current_shipment_id INTEGER, -- Links to acc_shipment if in transit
  
  -- Dispensing info
  dispensed_to_subject_id INTEGER REFERENCES study_subject(study_subject_id),
  dispensed_at TIMESTAMP,
  dispensed_by INTEGER REFERENCES user_account(user_id),
  dispensing_visit VARCHAR(100), -- Visit name when dispensed
  
  -- Return info
  returned_at TIMESTAMP,
  returned_by INTEGER REFERENCES user_account(user_id),
  return_reason TEXT,
  return_condition VARCHAR(50), -- full, partial, damaged, unused
  
  -- Destruction
  destroyed_at TIMESTAMP,
  destroyed_by INTEGER REFERENCES user_account(user_id),
  destruction_reason TEXT,
  destruction_witness VARCHAR(255),
  
  -- Audit
  created_by INTEGER REFERENCES user_account(user_id),
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Shipments
CREATE TABLE IF NOT EXISTS acc_shipment (
  shipment_id SERIAL PRIMARY KEY,
  study_id INTEGER REFERENCES study(study_id) NOT NULL,
  shipment_number VARCHAR(100) NOT NULL UNIQUE,
  shipment_type VARCHAR(50) DEFAULT 'outbound', -- outbound (depot to site), return (site to depot)
  
  -- Source and destination
  source_type VARCHAR(50) NOT NULL, -- depot, site
  source_id VARCHAR(100), -- depot ID or site_id
  source_name VARCHAR(255),
  destination_type VARCHAR(50) NOT NULL, -- depot, site
  destination_id INTEGER, -- site_id (study_id of child study)
  destination_name VARCHAR(255),
  
  -- Shipment details
  carrier VARCHAR(255),
  tracking_number VARCHAR(255),
  shipping_conditions VARCHAR(255), -- ambient, cold_chain
  package_count INTEGER DEFAULT 1,
  
  -- Status and dates
  status VARCHAR(30) DEFAULT 'pending', -- pending, in_transit, delivered, cancelled
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  requested_by INTEGER REFERENCES user_account(user_id),
  shipped_at TIMESTAMP,
  shipped_by INTEGER REFERENCES user_account(user_id),
  expected_delivery DATE,
  delivered_at TIMESTAMP,
  received_by INTEGER REFERENCES user_account(user_id),
  
  -- Notes and issues
  shipping_notes TEXT,
  receipt_notes TEXT,
  has_temperature_excursion BOOLEAN DEFAULT false,
  
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Temperature logs (for cold chain tracking)
CREATE TABLE IF NOT EXISTS acc_temperature_log (
  log_id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL, -- shipment, site_storage
  entity_id INTEGER NOT NULL,
  
  recorded_at TIMESTAMP NOT NULL,
  temperature NUMERIC NOT NULL, -- Celsius
  humidity NUMERIC, -- Percentage
  
  is_excursion BOOLEAN DEFAULT false,
  excursion_duration_minutes INTEGER,
  
  recorded_by INTEGER REFERENCES user_account(user_id),
  device_id VARCHAR(100), -- Temperature logger device ID
  notes TEXT,
  
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Kit dispensing records
CREATE TABLE IF NOT EXISTS acc_kit_dispensing (
  dispensing_id SERIAL PRIMARY KEY,
  kit_id INTEGER REFERENCES acc_kit(kit_id) NOT NULL,
  study_subject_id INTEGER REFERENCES study_subject(study_subject_id) NOT NULL,
  study_event_id INTEGER REFERENCES study_event(study_event_id), -- Visit when dispensed
  
  -- Dispensing details
  dispensed_at TIMESTAMP NOT NULL,
  dispensed_by INTEGER REFERENCES user_account(user_id) NOT NULL,
  
  -- Verification
  kit_number_verified BOOLEAN DEFAULT true,
  subject_id_verified BOOLEAN DEFAULT true,
  expiration_verified BOOLEAN DEFAULT true,
  
  -- Dose instructions
  dosing_instructions TEXT,
  quantity_dispensed INTEGER DEFAULT 1,
  
  -- E-signature
  signature_id INTEGER, -- Links to e-signature record
  
  notes TEXT,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inventory alerts
CREATE TABLE IF NOT EXISTS acc_inventory_alert (
  alert_id SERIAL PRIMARY KEY,
  study_id INTEGER REFERENCES study(study_id) NOT NULL,
  site_id INTEGER REFERENCES study(study_id), -- NULL for depot-level
  kit_type_id INTEGER REFERENCES acc_kit_type(kit_type_id),
  
  alert_type VARCHAR(50) NOT NULL, -- low_stock, expiring_soon, temperature_excursion
  severity VARCHAR(20) DEFAULT 'warning', -- info, warning, critical
  message TEXT NOT NULL,
  
  threshold_value INTEGER,
  current_value INTEGER,
  
  status VARCHAR(20) DEFAULT 'open', -- open, acknowledged, resolved
  acknowledged_at TIMESTAMP,
  acknowledged_by INTEGER REFERENCES user_account(user_id),
  resolved_at TIMESTAMP,
  resolved_by INTEGER REFERENCES user_account(user_id),
  
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kit_type_study ON acc_kit_type(study_id);
CREATE INDEX IF NOT EXISTS idx_kit_type_id ON acc_kit(kit_type_id);
CREATE INDEX IF NOT EXISTS idx_kit_status ON acc_kit(status);
CREATE INDEX IF NOT EXISTS idx_kit_site ON acc_kit(current_site_id);
CREATE INDEX IF NOT EXISTS idx_kit_expiration ON acc_kit(expiration_date);
CREATE INDEX IF NOT EXISTS idx_kit_subject ON acc_kit(dispensed_to_subject_id);
CREATE INDEX IF NOT EXISTS idx_shipment_study ON acc_shipment(study_id);
CREATE INDEX IF NOT EXISTS idx_shipment_status ON acc_shipment(status);
CREATE INDEX IF NOT EXISTS idx_shipment_dest ON acc_shipment(destination_id);
CREATE INDEX IF NOT EXISTS idx_temp_log_entity ON acc_temperature_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_dispensing_kit ON acc_kit_dispensing(kit_id);
CREATE INDEX IF NOT EXISTS idx_dispensing_subject ON acc_kit_dispensing(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_inventory_alert_status ON acc_inventory_alert(status);
CREATE INDEX IF NOT EXISTS idx_inventory_alert_study ON acc_inventory_alert(study_id);

-- Add email templates for IRT
INSERT INTO acc_email_template (name, subject, html_body, text_body, description, variables)
VALUES 
(
  'irt_shipment_created',
  'Shipment Created - {{studyName}}',
  '<h2>Shipment Created</h2><p>Hi {{userName}},</p><p>A new shipment has been created:</p><table><tr><td><strong>Shipment #:</strong></td><td>{{shipmentNumber}}</td></tr><tr><td><strong>Destination:</strong></td><td>{{destinationName}}</td></tr><tr><td><strong>Kits:</strong></td><td>{{kitCount}}</td></tr><tr><td><strong>Expected Delivery:</strong></td><td>{{expectedDelivery}}</td></tr></table><p><a href="{{shipmentUrl}}">View Shipment Details</a></p>',
  'Shipment Created\n\nHi {{userName}},\n\nA new shipment has been created:\n\nShipment #: {{shipmentNumber}}\nDestination: {{destinationName}}\nKits: {{kitCount}}\nExpected Delivery: {{expectedDelivery}}\n\nView Shipment Details: {{shipmentUrl}}',
  'Notification when a new shipment is created',
  '["userName", "studyName", "shipmentNumber", "destinationName", "kitCount", "expectedDelivery", "shipmentUrl"]'::jsonb
),
(
  'irt_shipment_delivered',
  'Shipment Delivered - {{studyName}}',
  '<h2>Shipment Delivered</h2><p>Hi {{userName}},</p><p>A shipment has been marked as delivered:</p><table><tr><td><strong>Shipment #:</strong></td><td>{{shipmentNumber}}</td></tr><tr><td><strong>Delivered To:</strong></td><td>{{destinationName}}</td></tr><tr><td><strong>Received By:</strong></td><td>{{receivedByName}}</td></tr><tr><td><strong>Kits Received:</strong></td><td>{{kitCount}}</td></tr></table>',
  'Shipment Delivered\n\nHi {{userName}},\n\nA shipment has been marked as delivered:\n\nShipment #: {{shipmentNumber}}\nDelivered To: {{destinationName}}\nReceived By: {{receivedByName}}\nKits Received: {{kitCount}}',
  'Notification when a shipment is delivered',
  '["userName", "studyName", "shipmentNumber", "destinationName", "receivedByName", "kitCount"]'::jsonb
),
(
  'irt_low_inventory',
  'Low Inventory Alert - {{studyName}}',
  '<h2>Low Inventory Alert</h2><p>Hi {{userName}},</p><p>Inventory is running low:</p><table><tr><td><strong>Site:</strong></td><td>{{siteName}}</td></tr><tr><td><strong>Product:</strong></td><td>{{productName}}</td></tr><tr><td><strong>Current Stock:</strong></td><td>{{currentStock}}</td></tr><tr><td><strong>Threshold:</strong></td><td>{{threshold}}</td></tr></table><p>Please arrange a resupply shipment.</p>',
  'Low Inventory Alert\n\nHi {{userName}},\n\nInventory is running low:\n\nSite: {{siteName}}\nProduct: {{productName}}\nCurrent Stock: {{currentStock}}\nThreshold: {{threshold}}\n\nPlease arrange a resupply shipment.',
  'Alert when inventory falls below threshold',
  '["userName", "studyName", "siteName", "productName", "currentStock", "threshold"]'::jsonb
),
(
  'irt_expiring_kits',
  'Expiring Kits Alert - {{studyName}}',
  '<h2>Expiring Kits Alert</h2><p>Hi {{userName}},</p><p>The following kits are expiring soon:</p><table><tr><td><strong>Site:</strong></td><td>{{siteName}}</td></tr><tr><td><strong>Product:</strong></td><td>{{productName}}</td></tr><tr><td><strong>Expiring Within:</strong></td><td>{{daysUntilExpiry}} days</td></tr><tr><td><strong>Kit Count:</strong></td><td>{{kitCount}}</td></tr></table><p>Please take appropriate action.</p>',
  'Expiring Kits Alert\n\nHi {{userName}},\n\nThe following kits are expiring soon:\n\nSite: {{siteName}}\nProduct: {{productName}}\nExpiring Within: {{daysUntilExpiry}} days\nKit Count: {{kitCount}}\n\nPlease take appropriate action.',
  'Alert when kits are approaching expiration',
  '["userName", "studyName", "siteName", "productName", "daysUntilExpiry", "kitCount"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Down Migration (for rollback)
-- DROP TABLE IF EXISTS acc_inventory_alert;
-- DROP TABLE IF EXISTS acc_kit_dispensing;
-- DROP TABLE IF EXISTS acc_temperature_log;
-- DROP TABLE IF EXISTS acc_shipment;
-- DROP TABLE IF EXISTS acc_kit;
-- DROP TABLE IF EXISTS acc_kit_type;

