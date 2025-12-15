/**
 * Backup API Endpoint Tests
 * 
 * Tests REST API endpoints for backup system
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app';
import * as schedulerService from '../src/services/backup/backup-scheduler.service';

describe('Backup API Endpoints', () => {
  afterEach(async () => {
    try {
      await schedulerService.stopScheduler();
    } catch (e) {
      // Ignore
    }
  });

  describe('GET /api/backup/status', () => {
    it('should return backup system status', async () => {
      const response = await request(app)
        .get('/api/backup/status')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data).toHaveProperty('statistics');
      expect(response.body.data).toHaveProperty('scheduler');
      expect(response.body.data).toHaveProperty('config');
    });
  });

  describe('GET /api/backup/config', () => {
    it('should return backup configuration', async () => {
      const response = await request(app)
        .get('/api/backup/config')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('retentionDays');
      expect(response.body.data).toHaveProperty('schedules');
    });
  });

  describe('GET /api/backup/list', () => {
    it('should return list of backups', async () => {
      const response = await request(app)
        .get('/api/backup/list')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should support type filter', async () => {
      const response = await request(app)
        .get('/api/backup/list?type=full')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should support limit parameter', async () => {
      const response = await request(app)
        .get('/api/backup/list?limit=5')
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /api/backup/:backupId', () => {
    it('should return 404 for non-existent backup', async () => {
      const response = await request(app)
        .get('/api/backup/BKP-9999-99-99-FULL-9999999999')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/backup/trigger', () => {
    it('should require backup type', async () => {
      const response = await request(app)
        .post('/api/backup/trigger')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject invalid backup type', async () => {
      const response = await request(app)
        .post('/api/backup/trigger')
        .send({ type: 'invalid' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/backup/:backupId/restore', () => {
    it('should require confirmation', async () => {
      const response = await request(app)
        .post('/api/backup/BKP-9999-99-99-FULL-9999999999/restore')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('confirmation');
    });
  });

  describe('GET /api/backup/scheduler/status', () => {
    it('should return scheduler status', async () => {
      const response = await request(app)
        .get('/api/backup/scheduler/status')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('running');
    });
  });

  describe('POST /api/backup/scheduler/start', () => {
    it('should start the scheduler', async () => {
      const response = await request(app)
        .post('/api/backup/scheduler/start')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.running).toBe(true);
    });
  });

  describe('POST /api/backup/scheduler/stop', () => {
    it('should stop the scheduler', async () => {
      // Start first
      await request(app).post('/api/backup/scheduler/start');

      // Then stop
      const response = await request(app)
        .post('/api/backup/scheduler/stop')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.running).toBe(false);
    });
  });

  describe('POST /api/backup/cleanup', () => {
    it('should perform cleanup', async () => {
      const response = await request(app)
        .post('/api/backup/cleanup')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('deleted');
      expect(response.body.data).toHaveProperty('freed');
    });
  });
});
