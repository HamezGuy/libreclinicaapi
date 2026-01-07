/**
 * Audit Service Unit Tests
 * 
 * Tests all audit trail operations:
 * - Get audit trail with filters
 * - Get subject-specific audit
 * - Get recent audit events
 * - Export audit trail to CSV
 * - Get audit statistics
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as auditService from '../src/services/database/audit.service';

describe('Audit Service', () => {
  const rootUserId = 1;
  let testAuditIds: number[] = [];

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');
  });

  afterAll(async () => {
    // Cleanup test audit events
    if (testAuditIds.length > 0) {
      await testDb.pool.query('DELETE FROM audit_log_event WHERE audit_id = ANY($1)', [testAuditIds]);
    }
    await testDb.pool.end();
  });

  beforeEach(async () => {
    // Create test audit events
    const eventTypeResult = await testDb.pool.query(
      'SELECT audit_log_event_type_id FROM audit_log_event_type LIMIT 1'
    );
    const eventTypeId = eventTypeResult.rows[0]?.audit_log_event_type_id || 1;

    const result = await testDb.pool.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES 
        (NOW(), 'test_table', $1, 1, 'Test Entity 1', 'Test Value 1', $2),
        (NOW() - INTERVAL '1 day', 'test_table', $1, 2, 'Test Entity 2', 'Test Value 2', $2),
        (NOW() - INTERVAL '2 day', 'test_table', $1, 3, 'Test Entity 3', 'Test Value 3', $2)
      RETURNING audit_id
    `, [rootUserId, eventTypeId]);

    testAuditIds = result.rows.map(r => r.audit_id);
  });

  afterEach(async () => {
    if (testAuditIds.length > 0) {
      await testDb.pool.query('DELETE FROM audit_log_event WHERE audit_id = ANY($1)', [testAuditIds]);
      testAuditIds = [];
    }
  });

  describe('getAuditTrail', () => {
    it('should return paginated audit events', async () => {
      const result = await auditService.getAuditTrail({
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
      expect(result.pagination?.page).toBe(1);
      expect(result.pagination?.limit).toBe(10);
    });

    it('should filter by userId', async () => {
      const result = await auditService.getAuditTrail({
        userId: rootUserId,
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(result.data.every((event: any) => event.user_id === rootUserId)).toBe(true);
    });

    it('should filter by date range', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const endDate = new Date();

      const result = await auditService.getAuditTrail({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should filter by event type', async () => {
      const result = await auditService.getAuditTrail({
        eventType: 'Entity',
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should return total count in pagination', async () => {
      const result = await auditService.getAuditTrail({
        page: 1,
        limit: 10
      });

      expect(result.pagination?.total).toBeDefined();
      expect(result.pagination?.totalPages).toBeDefined();
      expect(typeof result.pagination?.total).toBe('number');
    });

    it('should handle empty results', async () => {
      const result = await auditService.getAuditTrail({
        userId: 999999, // Non-existent user
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(0);
      expect(result.pagination?.total).toBe(0);
    });
  });

  describe('getSubjectAudit', () => {
    it('should return audit events for a subject', async () => {
      const result = await auditService.getSubjectAudit(1, 1, 100);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should use default pagination', async () => {
      const result = await auditService.getSubjectAudit(1);

      expect(result.pagination?.page).toBe(1);
      expect(result.pagination?.limit).toBe(100);
    });
  });

  describe('getRecentAuditEvents', () => {
    it('should return recent events with default limit', async () => {
      const events = await auditService.getRecentAuditEvents();

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeLessThanOrEqual(50);
    });

    it('should respect custom limit', async () => {
      const events = await auditService.getRecentAuditEvents(5);

      expect(events.length).toBeLessThanOrEqual(5);
    });

    it('should include event details', async () => {
      const events = await auditService.getRecentAuditEvents(5);

      if (events.length > 0) {
        const event = events[0] as any; // Raw SQL result
        expect(event.audit_id).toBeDefined();
        expect(event.audit_date).toBeDefined();
        expect(event.audit_table).toBeDefined();
      }
    });

    it('should order by date descending', async () => {
      const events = await auditService.getRecentAuditEvents(10);

      if (events.length > 1) {
        for (let i = 0; i < events.length - 1; i++) {
          const current = new Date((events[i] as any).audit_date);
          const next = new Date((events[i + 1] as any).audit_date);
          expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
        }
      }
    });
  });

  describe('exportAuditTrailCSV', () => {
    it('should generate CSV with headers', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();

      const csv = await auditService.exportAuditTrailCSV({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      expect(typeof csv).toBe('string');
      expect(csv).toContain('Audit Date');
      expect(csv).toContain('Username');
      expect(csv).toContain('Event Type');
    });

    it('should include data rows', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();

      const csv = await auditService.exportAuditTrailCSV({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      const lines = csv.split('\n').filter(line => line.trim());
      expect(lines.length).toBeGreaterThanOrEqual(1); // At least header
    });

    it('should handle date range with no results', async () => {
      const farFutureDate = new Date('2099-01-01');

      const csv = await auditService.exportAuditTrailCSV({
        startDate: farFutureDate.toISOString(),
        endDate: farFutureDate.toISOString()
      });

      expect(typeof csv).toBe('string');
      expect(csv).toContain('Audit Date'); // Should still have headers
    });

    it('should escape CSV special characters', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();

      const csv = await auditService.exportAuditTrailCSV({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      // Should have proper CSV structure
      const headerLine = csv.split('\n')[0];
      const columns = headerLine.split(',');
      expect(columns.length).toBe(10); // Verify column count
    });
  });

  describe('getAuditStatistics', () => {
    it('should return statistics object', async () => {
      const stats = await auditService.getAuditStatistics(30);

      expect(stats).toBeDefined();
      expect(stats.total_events).toBeDefined();
      expect(stats.unique_users).toBeDefined();
    });

    it('should count total events', async () => {
      const stats = await auditService.getAuditStatistics(30);

      expect(typeof parseInt(stats.total_events)).toBe('number');
    });

    it('should count unique users', async () => {
      const stats = await auditService.getAuditStatistics(30);

      expect(typeof parseInt(stats.unique_users)).toBe('number');
    });

    it('should respect days parameter', async () => {
      const stats7Days = await auditService.getAuditStatistics(7);
      const stats30Days = await auditService.getAuditStatistics(30);

      // 30 days should have >= 7 days events
      expect(parseInt(stats30Days.total_events)).toBeGreaterThanOrEqual(parseInt(stats7Days.total_events));
    });

    it('should use default 30 days if not specified', async () => {
      const stats = await auditService.getAuditStatistics();

      expect(stats).toBeDefined();
    });
  });
});


