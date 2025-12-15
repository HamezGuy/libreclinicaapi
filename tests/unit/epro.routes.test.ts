/**
 * Unit Tests for ePRO/Patient Portal Routes
 * 
 * Tests patient accounts, PRO instruments, and assignment management
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock the database pool
const mockQuery = jest.fn();

jest.mock('../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn()
    })
  }
}));

jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock auth middleware
jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = { userId: 1, username: 'testuser' };
    next();
  }
}));

describe('ePRO Routes', () => {
  let app: express.Application;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    // Import routes after mocks are set up
    const { default: eproRoutes } = await import('../../src/routes/epro.routes');
    app.use('/api/epro', eproRoutes);
  });

  describe('GET /api/epro/dashboard', () => {
    it('should return dashboard statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '10' }] }) // total patients
        .mockResolvedValueOnce({ rows: [{ pending: '5' }] }) // pending
        .mockResolvedValueOnce({ rows: [{ overdue: '2' }] }) // overdue
        .mockResolvedValueOnce({ rows: [{ completed: '20' }] }); // completed

      const response = await request(app).get('/api/epro/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/epro/instruments', () => {
    it('should return list of PRO instruments', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { instrument_id: 1, short_name: 'PHQ-9', name: 'Patient Health Questionnaire-9' },
          { instrument_id: 2, short_name: 'GAD-7', name: 'Generalized Anxiety Disorder 7-item' }
        ]
      });

      const response = await request(app).get('/api/epro/instruments');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/epro/instruments/:id', () => {
    it('should return instrument details', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          instrument_id: 1,
          short_name: 'PHQ-9',
          name: 'Patient Health Questionnaire-9',
          description: 'Depression screening',
          content: { questions: [] }
        }]
      });

      const response = await request(app).get('/api/epro/instruments/1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.short_name).toBe('PHQ-9');
    });

    it('should return 404 when instrument not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/epro/instruments/999');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/epro/instruments', () => {
    it('should create new instrument', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          instrument_id: 3,
          short_name: 'CUSTOM-1',
          name: 'Custom Questionnaire'
        }]
      });

      const response = await request(app)
        .post('/api/epro/instruments')
        .send({
          shortName: 'CUSTOM-1',
          name: 'Custom Questionnaire',
          description: 'Custom PRO',
          content: { questions: [] }
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/epro/assignments', () => {
    it('should return list of assignments', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { assignment_id: 1, status: 'pending', scheduled_date: new Date() },
          { assignment_id: 2, status: 'completed', scheduled_date: new Date() }
        ]
      });

      const response = await request(app).get('/api/epro/assignments');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('POST /api/epro/assignments', () => {
    it('should create new assignment', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ assignment_id: 1 }]
      });

      const response = await request(app)
        .post('/api/epro/assignments')
        .send({
          studySubjectId: 1,
          instrumentId: 1,
          scheduledDate: new Date().toISOString()
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/epro/assignments/:id/respond', () => {
    it('should submit PRO response', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ assignment_id: 1, status: 'pending' }] }) // get assignment
        .mockResolvedValueOnce({ rows: [{ response_id: 1 }] }) // insert response
        .mockResolvedValueOnce({ rowCount: 1 }); // update assignment

      const response = await request(app)
        .post('/api/epro/assignments/1/respond')
        .send({
          answers: { phq1: 2, phq2: 1 },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/epro/patients', () => {
    it('should return list of patient accounts', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { patient_account_id: 1, email: 'patient1@example.com', status: 'active' },
          { patient_account_id: 2, email: 'patient2@example.com', status: 'pending' }
        ]
      });

      const response = await request(app).get('/api/epro/patients');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });
});

