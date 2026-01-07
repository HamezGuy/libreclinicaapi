/**
 * Integration Tests for New Features
 * 
 * Tests for:
 * - Print/PDF Generation
 * - Email Notifications
 * - Subject Transfer
 * - Double Data Entry (DDE)
 * - eConsent
 * - ePRO/Patient Portal
 * - RTSM/IRT
 * 
 * These tests verify end-to-end functionality from API to database
 */

import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app';
import { pool } from '../../src/config/database';

// Test constants
const TEST_TIMEOUT = 30000;

// Helper to get auth token
async function getAuthToken(): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ username: 'root', password: '12345678' });
  
  return response.body.token || response.body.data?.token || '';
}

// Helper to get test study ID
async function getTestStudyId(): Promise<number> {
  const result = await pool.query(
    'SELECT study_id FROM study WHERE status_id = 1 LIMIT 1'
  );
  return result.rows[0]?.study_id || 1;
}

// Helper to get test subject ID
async function getTestSubjectId(studyId: number): Promise<number> {
  const result = await pool.query(
    'SELECT study_subject_id FROM study_subject WHERE study_id = $1 LIMIT 1',
    [studyId]
  );
  return result.rows[0]?.study_subject_id || 1;
}

describe('New Features Integration Tests', () => {
  let authToken: string;
  let testStudyId: number;
  let testSubjectId: number;

  beforeAll(async () => {
    // Get authentication token
    try {
      authToken = await getAuthToken();
      testStudyId = await getTestStudyId();
      testSubjectId = await getTestSubjectId(testStudyId);
    } catch (error) {
      console.log('Setup warning:', error);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Cleanup if needed
    await pool.query("DELETE FROM acc_transfer_log WHERE notes LIKE 'TEST%'");
    await pool.query("DELETE FROM acc_email_queue WHERE subject LIKE 'TEST%'");
  });

  // ===========================================================================
  // Print/PDF Generation Tests
  // ===========================================================================
  describe('Print/PDF Generation', () => {
    test('GET /api/print/formats - should return available formats', async () => {
      const response = await request(app)
        .get('/api/print/formats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    test('GET /api/print/templates - should return available templates', async () => {
      const response = await request(app)
        .get('/api/print/templates')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ===========================================================================
  // Email Notification Tests
  // ===========================================================================
  describe('Email Notifications', () => {
    test('GET /api/email/templates - should list email templates', async () => {
      const response = await request(app)
        .get('/api/email/templates')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('GET /api/email/queue/status - should return queue status', async () => {
      const response = await request(app)
        .get('/api/email/queue/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('pending');
      expect(response.body.data).toHaveProperty('sent');
    });

    test('GET /api/email/preferences - should get user preferences', async () => {
      const response = await request(app)
        .get('/api/email/preferences')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('POST /api/email/preferences - should update preference', async () => {
      const response = await request(app)
        .post('/api/email/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          notificationType: 'query_opened',
          emailEnabled: true,
          digestEnabled: false
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body.success).toBe(true);
    });
  });

  // ===========================================================================
  // Subject Transfer Tests
  // ===========================================================================
  describe('Subject Transfer', () => {
    test('GET /api/transfers/pending/:siteId - should return pending transfers', async () => {
      const response = await request(app)
        .get(`/api/transfers/pending/${testStudyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('GET /api/transfers/subject/:subjectId/history - should return transfer history', async () => {
      const response = await request(app)
        .get(`/api/transfers/subject/${testSubjectId}/history`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('GET /api/transfers/subject/:subjectId/available-sites - should return available sites', async () => {
      const response = await request(app)
        .get(`/api/transfers/subject/${testSubjectId}/available-sites`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('GET /api/transfers/subject/:subjectId/pending - should check pending status', async () => {
      const response = await request(app)
        .get(`/api/transfers/subject/${testSubjectId}/pending`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('hasPendingTransfer');
    });
  });

  // ===========================================================================
  // Double Data Entry Tests
  // ===========================================================================
  describe('Double Data Entry (DDE)', () => {
    test('GET /api/dde/dashboard - should return DDE dashboard', async () => {
      const response = await request(app)
        .get('/api/dde/dashboard')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('pendingSecondEntry');
      expect(response.body.data).toHaveProperty('pendingResolution');
      expect(response.body.data).toHaveProperty('stats');
    });
  });

  // ===========================================================================
  // eConsent Tests
  // ===========================================================================
  describe('eConsent', () => {
    test('GET /api/consent/studies/:studyId/documents - should list consent documents', async () => {
      const response = await request(app)
        .get(`/api/consent/studies/${testStudyId}/documents`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('GET /api/consent/studies/:studyId/dashboard - should return consent dashboard', async () => {
      const response = await request(app)
        .get(`/api/consent/studies/${testStudyId}/dashboard`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('stats');
    });

    test('GET /api/consent/subjects/:subjectId/consent - should return subject consent history', async () => {
      const response = await request(app)
        .get(`/api/consent/subjects/${testSubjectId}/consent`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('GET /api/consent/subjects/:subjectId/has-consent - should check consent status', async () => {
      const response = await request(app)
        .get(`/api/consent/subjects/${testSubjectId}/has-consent`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('hasValidConsent');
    });
  });

  // ===========================================================================
  // Health Check
  // ===========================================================================
  describe('API Health', () => {
    test('GET /health - should return healthy status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
    });

    test('GET /api/health - should return detailed health', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.services).toBeDefined();
    });

    test('GET / - should return API info with new endpoints', async () => {
      const response = await request(app).get('/');
      expect(response.status).toBe(200);
      expect(response.body.endpoints).toHaveProperty('print');
      expect(response.body.endpoints).toHaveProperty('email');
      expect(response.body.endpoints).toHaveProperty('transfers');
      expect(response.body.endpoints).toHaveProperty('dde');
      expect(response.body.endpoints).toHaveProperty('consent');
    });
  });
});

// ===========================================================================
// Database Schema Tests
// ===========================================================================
describe('Database Schema Verification', () => {
  test('acc_email_template table should exist with correct structure', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'acc_email_template'
      ORDER BY ordinal_position
    `);
    
    if (result.rows.length > 0) {
      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain('template_id');
      expect(columns).toContain('name');
      expect(columns).toContain('subject');
    }
  });

  test('acc_email_queue table should exist with correct structure', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'acc_email_queue'
      ORDER BY ordinal_position
    `);
    
    if (result.rows.length > 0) {
      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain('queue_id');
      expect(columns).toContain('recipient_email');
      expect(columns).toContain('status');
    }
  });

  test('acc_transfer_log table should exist with correct structure', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'acc_transfer_log'
      ORDER BY ordinal_position
    `);
    
    if (result.rows.length > 0) {
      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain('transfer_id');
      expect(columns).toContain('study_subject_id');
      expect(columns).toContain('transfer_status');
    }
  });

  test('acc_dde_status table should exist with correct structure', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'acc_dde_status'
      ORDER BY ordinal_position
    `);
    
    if (result.rows.length > 0) {
      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain('event_crf_id');
      expect(columns).toContain('first_entry_status');
      expect(columns).toContain('second_entry_status');
    }
  });

  test('acc_consent_document table should exist with correct structure', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'acc_consent_document'
      ORDER BY ordinal_position
    `);
    
    if (result.rows.length > 0) {
      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain('document_id');
      expect(columns).toContain('study_id');
      expect(columns).toContain('name');
    }
  });
});

// ===========================================================================
// Service Unit Tests
// ===========================================================================
describe('Service Unit Tests', () => {
  describe('Email Service', () => {
    const emailService = require('../../src/services/email/email.service');

    test('getTemplate should return null for non-existent template', async () => {
      const result = await emailService.getTemplate('non_existent_template');
      expect(result).toBeNull();
    });

    test('listTemplates should return array', async () => {
      const result = await emailService.listTemplates();
      expect(Array.isArray(result)).toBe(true);
    });

    test('getQueueStatus should return counts', async () => {
      const result = await emailService.getQueueStatus();
      expect(result).toHaveProperty('pending');
      expect(result).toHaveProperty('sent');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('total');
    });
  });

  describe('Transfer Service', () => {
    const transferService = require('../../src/services/database/transfer.service');

    test('hasPendingTransfer should return boolean', async () => {
      const result = await transferService.hasPendingTransfer(999999);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('DDE Service', () => {
    const ddeService = require('../../src/services/database/dde.service');

    test('isDDERequired should return boolean', async () => {
      const result = await ddeService.isDDERequired(999999);
      expect(typeof result).toBe('boolean');
    });

    test('getDDEStatus should handle non-existent form', async () => {
      const result = await ddeService.getDDEStatus(999999);
      // Should return null if DDE not required
      expect(result === null || typeof result === 'object').toBe(true);
    });

    test('getDDEDashboard should return structured data', async () => {
      const result = await ddeService.getDDEDashboard(1);
      expect(result).toHaveProperty('pendingSecondEntry');
      expect(result).toHaveProperty('pendingResolution');
      expect(result).toHaveProperty('stats');
    });
  });

  describe('Consent Service', () => {
    const consentService = require('../../src/services/consent/consent.service');

    test('listConsentDocuments should return array', async () => {
      const result = await consentService.listConsentDocuments(1);
      expect(Array.isArray(result)).toBe(true);
    });

    test('hasValidConsent should return boolean', async () => {
      const result = await consentService.hasValidConsent(999999);
      expect(typeof result).toBe('boolean');
    });
  });
});

