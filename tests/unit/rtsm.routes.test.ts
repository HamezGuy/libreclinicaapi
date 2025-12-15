/**
 * Unit Tests for RTSM/IRT Routes
 * 
 * Tests kit management, shipments, dispensing, and temperature logging
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

describe('RTSM Routes', () => {
  let app: express.Application;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    const { default: rtsmRoutes } = await import('../../src/routes/rtsm.routes');
    app.use('/api/rtsm', rtsmRoutes);
  });

  describe('GET /api/rtsm/dashboard', () => {
    it('should return dashboard statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '100', available: '50', dispensed: '30', reserved: '10', expiring: '5' }] })
        .mockResolvedValueOnce({ rows: [{ pending: '3', in_transit: '2' }] });

      const response = await request(app).get('/api/rtsm/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/rtsm/kit-types', () => {
    it('should return list of kit types', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { kit_type_id: 1, name: 'Treatment A', storage_conditions: 'Room Temperature' },
          { kit_type_id: 2, name: 'Treatment B', storage_conditions: 'Refrigerated' }
        ]
      });

      const response = await request(app).get('/api/rtsm/kit-types');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/rtsm/kits', () => {
    it('should return list of kits', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { kit_id: 1, kit_number: 'KIT001', status: 'available' },
          { kit_id: 2, kit_number: 'KIT002', status: 'dispensed' }
        ]
      });

      const response = await request(app).get('/api/rtsm/kits');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('should filter kits by status', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ kit_id: 1, kit_number: 'KIT001', status: 'available' }]
      });

      const response = await request(app).get('/api/rtsm/kits?status=available');

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/rtsm/kits', () => {
    it('should register new kit', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          kit_id: 1,
          kit_number: 'KIT001',
          kit_type_id: 1,
          status: 'available'
        }]
      });

      const response = await request(app)
        .post('/api/rtsm/kits')
        .send({
          kitTypeId: 1,
          kitNumber: 'KIT001',
          batchNumber: 'BATCH001',
          lotNumber: 'LOT001',
          expirationDate: '2025-12-31'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/rtsm/kits/:id/reserve', () => {
    it('should reserve kit for subject', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ kit_id: 1, status: 'reserved' }]
      });

      const response = await request(app)
        .post('/api/rtsm/kits/1/reserve')
        .send({ subjectId: 1 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/rtsm/shipments', () => {
    it('should return list of shipments', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { shipment_id: 1, shipment_number: 'SHIP001', status: 'pending' },
          { shipment_id: 2, shipment_number: 'SHIP002', status: 'delivered' }
        ]
      });

      const response = await request(app).get('/api/rtsm/shipments');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('POST /api/rtsm/shipments', () => {
    it('should create new shipment', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          shipment_id: 1,
          shipment_number: 'SHIP001',
          status: 'pending'
        }]
      });

      const response = await request(app)
        .post('/api/rtsm/shipments')
        .send({
          studyId: 1,
          destinationSiteId: 2,
          kitIds: [1, 2, 3],
          carrier: 'FedEx'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/rtsm/shipments/:id/ship', () => {
    it('should mark shipment as shipped', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ shipment_id: 1, status: 'in_transit' }]
      });

      const response = await request(app)
        .post('/api/rtsm/shipments/1/ship')
        .send({ trackingNumber: 'TRACK123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/rtsm/shipments/:id/confirm', () => {
    it('should confirm shipment receipt', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const response = await request(app)
        .post('/api/rtsm/shipments/1/confirm')
        .send({ receivedKitIds: [1, 2, 3] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/rtsm/dispense', () => {
    it('should dispense kit to subject', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ kit_id: 1, status: 'dispensed' }]
      });

      const response = await request(app)
        .post('/api/rtsm/dispense')
        .send({
          kitId: 1,
          studySubjectId: 1,
          visitId: 1
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/rtsm/dispensations', () => {
    it('should return dispensation history', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { dispensing_id: 1, kit_number: 'KIT001', dispensed_at: new Date() }
        ]
      });

      const response = await request(app).get('/api/rtsm/dispensations');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe('POST /api/rtsm/temperature', () => {
    it('should log temperature reading', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          log_id: 1,
          temperature: 22.5,
          is_excursion: false
        }]
      });

      const response = await request(app)
        .post('/api/rtsm/temperature')
        .send({
          entityType: 'site_storage',
          entityId: 1,
          temperature: 22.5,
          humidity: 45
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/rtsm/temperature', () => {
    it('should return temperature logs', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { log_id: 1, temperature: 22.5, is_excursion: false },
          { log_id: 2, temperature: 28.0, is_excursion: true }
        ]
      });

      const response = await request(app).get('/api/rtsm/temperature');

      expect(response.status).toBe(200);
      expect(response.body.data.readings).toHaveLength(2);
    });
  });
});

