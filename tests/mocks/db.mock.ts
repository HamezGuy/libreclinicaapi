import { newDb, IMemoryDb } from 'pg-mem';
import { logger } from '../../src/config/logger';

/**
 * Mock Database
 * Creates an in-memory PostgreSQL database for testing
 */
export const createMockDb = async () => {
  const db = newDb();
  
  // Register custom functions
  db.public.registerFunction({
    name: 'now',
    implementation: () => new Date().toISOString(),
  });

  db.public.registerFunction({
    name: 'version',
    implementation: () => 'PostgreSQL 14.0 (Mock)',
  });

  // Initialize Schema
  await initSchema(db);

  // Create a simple client-like object that uses db directly
  const connection = {
    query: async (text: string, params?: any[]) => {
      try {
        // pg-mem query expects params to be part of text or bind variables?
        // pg-mem supports basic parameter binding if we use the adapter, 
        // but for direct usage we might need to be careful.
        // Actually, let's use the adapter but instantiate Pool which is often more robust
        // or just use the db.public.query(text, params) if it supports it.
        // db.public.query returns { rows }
        
        // NOTE: pg-mem db.public.query does NOT support $1, $2 style parameters out of the box easily without adapter.
        // So we MUST use the adapter. 
        // Let's use the Pool instead of Client, it might be easier.
        
        // Fallback: Return adapter pool
      } catch (e) {
        throw e;
      }
    },
    connect: async () => {},
    release: () => {},
    end: async () => {}
  };

  // Better approach: Use the Pool adapter
  const pgMock = db.adapters.createPg();
  const pool = new pgMock.Pool();
  
  // Ensure we return something that looks like a client but is actually a pool (since pool handles queries)
  // Or just return the pool.
  return { db, connection: pool };
};

/**
 * Initialize Database Schema with essential tables
 */
async function initSchema(db: IMemoryDb) {
  try {
    // User Management Tables
    db.public.none(`
      CREATE TABLE user_type (
        user_type_id SERIAL PRIMARY KEY,
        user_type VARCHAR(50)
      );
      
      CREATE TABLE status (
        status_id SERIAL PRIMARY KEY,
        name VARCHAR(50)
      );

      CREATE TABLE user_account (
        user_id SERIAL PRIMARY KEY,
        user_name VARCHAR(64) UNIQUE NOT NULL,
        first_name VARCHAR(50),
        last_name VARCHAR(50),
        email VARCHAR(120),
        passwd VARCHAR(255),
        passwd_timestamp TIMESTAMP,
        phone VARCHAR(40),
        institutional_affiliation VARCHAR(255),
        user_type_id INTEGER,
        status_id INTEGER,
        owner_id INTEGER,
        date_created TIMESTAMP,
        date_updated TIMESTAMP,
        date_lastvisit TIMESTAMP,
        enabled BOOLEAN DEFAULT TRUE,
        account_non_locked BOOLEAN DEFAULT TRUE,
        failed_login_attempts INTEGER DEFAULT 0,
        update_id INTEGER
      );

      CREATE TABLE study (
        study_id SERIAL PRIMARY KEY,
        parent_study_id INTEGER,
        unique_identifier VARCHAR(255) UNIQUE,
        name VARCHAR(255),
        summary TEXT,
        protocol_description TEXT,
        date_planned_start DATE,
        date_planned_end DATE,
        date_created DATE,
        date_updated DATE,
        owner_id INTEGER,
        update_id INTEGER,
        status_id INTEGER,
        principal_investigator VARCHAR(255),
        sponsor VARCHAR(255),
        protocol_type VARCHAR(255),
        expected_total_enrollment INTEGER,
        oc_oid VARCHAR(255),
        type_id INTEGER
      );
      
      CREATE TABLE study_type (
        study_type_id SERIAL PRIMARY KEY,
        name VARCHAR(50)
      );

      CREATE TABLE study_user_role (
        role_name VARCHAR(50),
        study_id INTEGER,
        status_id INTEGER,
        owner_id INTEGER,
        date_created DATE,
        date_updated DATE,
        update_id INTEGER,
        user_name VARCHAR(64)
      );

      CREATE TABLE study_subject (
        study_subject_id SERIAL PRIMARY KEY,
        label VARCHAR(30),
        secondary_label VARCHAR(30),
        study_id INTEGER,
        status_id INTEGER,
        enrollment_date DATE,
        date_created DATE,
        date_updated DATE,
        owner_id INTEGER,
        update_id INTEGER,
        oc_oid VARCHAR(40)
      );

      CREATE TABLE study_event_definition (
        study_event_definition_id SERIAL PRIMARY KEY,
        study_id INTEGER,
        name VARCHAR(255),
        description VARCHAR(1000),
        repeating BOOLEAN,
        type VARCHAR(50),
        category VARCHAR(50),
        ordinal INTEGER,
        status_id INTEGER,
        date_created DATE,
        date_updated DATE,
        owner_id INTEGER,
        update_id INTEGER,
        oc_oid VARCHAR(40)
      );

      CREATE TABLE study_event (
        study_event_id SERIAL PRIMARY KEY,
        study_event_definition_id INTEGER,
        study_subject_id INTEGER,
        location VARCHAR(255),
        sample_ordinal INTEGER,
        date_start TIMESTAMP,
        date_end TIMESTAMP,
        owner_id INTEGER,
        status_id INTEGER,
        date_created DATE,
        date_updated DATE,
        subject_event_status_id INTEGER
      );

      CREATE TABLE discrepancy_note (
        discrepancy_note_id SERIAL PRIMARY KEY,
        description VARCHAR(255),
        detailed_notes VARCHAR(1000),
        entity_type VARCHAR(30),
        entity_id INTEGER,
        discrepancy_note_type_id INTEGER,
        resolution_status_id INTEGER,
        study_id INTEGER,
        owner_id INTEGER,
        assigned_user_id INTEGER,
        parent_dn_id INTEGER,
        date_created DATE,
        date_updated DATE,
        update_id INTEGER,
        study_subject_id INTEGER,
        event_crf_id INTEGER,
        item_data_id INTEGER
      );

      CREATE TABLE discrepancy_note_type (
        discrepancy_note_type_id SERIAL PRIMARY KEY,
        name VARCHAR(50)
      );

      CREATE TABLE resolution_status (
        resolution_status_id SERIAL PRIMARY KEY,
        name VARCHAR(50)
      );

      CREATE TABLE crf (
        crf_id SERIAL PRIMARY KEY,
        status_id INTEGER,
        name VARCHAR(255),
        description VARCHAR(2000),
        owner_id INTEGER,
        date_created DATE,
        date_updated DATE,
        study_id INTEGER,
        oc_oid VARCHAR(40)
      );

      CREATE TABLE crf_version (
        crf_version_id SERIAL PRIMARY KEY,
        crf_id INTEGER,
        name VARCHAR(255),
        description VARCHAR(2000),
        revision_notes VARCHAR(255),
        status_id INTEGER,
        date_created DATE,
        owner_id INTEGER,
        oc_oid VARCHAR(40)
      );
      
      CREATE TABLE item_group (
        item_group_id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        oc_oid VARCHAR(40)
      );

      CREATE TABLE item_group_metadata (
        item_group_metadata_id SERIAL PRIMARY KEY,
        item_group_id INTEGER,
        crf_version_id INTEGER,
        ordinal INTEGER
      );

      CREATE TABLE event_definition_crf (
        event_definition_crf_id SERIAL PRIMARY KEY,
        study_event_definition_id INTEGER,
        study_id INTEGER,
        crf_id INTEGER,
        required_crf BOOLEAN,
        double_entry BOOLEAN,
        require_all_text_validation BOOLEAN,
        decision_condition BOOLEAN,
        null_values BOOLEAN,
        default_version_id INTEGER,
        status_id INTEGER,
        ordinal INTEGER,
        electronic_signature BOOLEAN,
        hide_crf BOOLEAN,
        source_data_verification_code INTEGER,
        selected_version_ids VARCHAR(255),
        parent_id INTEGER,
        date_created DATE,
        date_updated DATE,
        owner_id INTEGER,
        update_id INTEGER
      );

      CREATE TABLE subject_event_status (
        subject_event_status_id SERIAL PRIMARY KEY,
        name VARCHAR(50)
      );

      CREATE TABLE audit_log_event (
        audit_id SERIAL PRIMARY KEY,
        audit_date TIMESTAMP,
        audit_table VARCHAR(50),
        user_id INTEGER,
        entity_id INTEGER,
        entity_name VARCHAR(255),
        reason_for_change VARCHAR(1000),
        audit_log_event_type_id INTEGER,
        event_type_id INTEGER,
        old_value VARCHAR(2000),
        new_value VARCHAR(2000),
        event_crf_id INTEGER,
        study_event_id INTEGER,
        event_crf_version_id INTEGER
      );

      CREATE TABLE audit_log_event_type (
        audit_log_event_type_id SERIAL PRIMARY KEY,
        name VARCHAR(255)
      );
      
      -- Insert Reference Data
      INSERT INTO status (status_id, name) VALUES (1, 'available'), (5, 'removed');
      INSERT INTO user_type (user_type_id, user_type) VALUES (1, 'admin'), (2, 'user');
      INSERT INTO audit_log_event_type (audit_log_event_type_id, name) VALUES (1, 'Entity Created'), (2, 'Entity Updated');
      INSERT INTO discrepancy_note_type (discrepancy_note_type_id, name) VALUES (1, 'Query'), (2, 'Failed Validation Check'), (3, 'Reason for Change'), (4, 'Annotation');
      INSERT INTO resolution_status (resolution_status_id, name) VALUES (1, 'New'), (2, 'Updated'), (3, 'Resolution Proposed'), (4, 'Closed'), (5, 'Not Applicable');
      
      -- Insert Root User
      INSERT INTO user_account (
        user_id, user_name, first_name, last_name, email, passwd, status_id, user_type_id, enabled
      ) VALUES (
        1, 'root', 'Root', 'User', 'root@example.com', '5f4dcc3b5aa765d61d8327deb882cf99', 1, 1, true
      );
    `);
  } catch (e) {
    logger.error('Schema initialization failed', e);
    throw e;
  }
}
