/**
 * Dashboard Service Unit Tests
 * 
 * Tests all dashboard analytics operations:
 * - Enrollment statistics
 * - Form completion statistics
 * - Query statistics
 * - User activity statistics
 * - Study progress
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as dashboardService from '../src/services/database/dashboard.service';
import { createTestStudy, createTestSubject, createTestEventDefinition } from './fixtures/test-data';

describe('Dashboard Service', () => {
  let testStudyId: number;
  let testSubjectIds: number[] = [];
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    // Create test study
    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `DASHBOARD-TEST-${Date.now()}`,
      name: 'Dashboard Test Study'
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testSubjectIds.length > 0) {
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = ANY($1)', [testSubjectIds]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  beforeEach(async () => {
    // Create test subjects for each test
    for (let i = 0; i < 3; i++) {
      const subjectId = await createTestSubject(testDb.pool, testStudyId, {
        label: `DASH-SUB-${Date.now()}-${i}`
      });
      testSubjectIds.push(subjectId);
    }
  });

  afterEach(async () => {
    // Cleanup subjects after each test
    if (testSubjectIds.length > 0) {
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = ANY($1)', [testSubjectIds]);
      testSubjectIds = [];
    }
  });

  describe('getEnrollmentStats', () => {
    it('should return enrollment statistics', async () => {
      const stats = await dashboardService.getEnrollmentStats(testStudyId);

      expect(stats).toBeDefined();
      expect(stats.totalSubjects).toBeDefined();
      expect(typeof stats.totalSubjects).toBe('number');
    });

    it('should count total subjects correctly', async () => {
      const stats = await dashboardService.getEnrollmentStats(testStudyId);

      // Should have at least the subjects we created
      expect(stats.totalSubjects).toBeGreaterThanOrEqual(3);
    });

    it('should return enrollment by month', async () => {
      const stats = await dashboardService.getEnrollmentStats(testStudyId);

      expect(stats.enrollmentByMonth).toBeDefined();
      expect(Array.isArray(stats.enrollmentByMonth)).toBe(true);
    });

    it('should calculate enrollment rate', async () => {
      const stats = await dashboardService.getEnrollmentStats(testStudyId);

      expect(stats.enrollmentRate).toBeDefined();
      expect(typeof stats.enrollmentRate).toBe('number');
    });

    it('should return target enrollment if set', async () => {
      // Update study with target enrollment
      await testDb.pool.query('UPDATE study SET expected_total_enrollment = 100 WHERE study_id = $1', [testStudyId]);

      const stats = await dashboardService.getEnrollmentStats(testStudyId);

      expect(stats.targetEnrollment).toBe(100);
    });

    it('should filter by date range', async () => {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      const endDate = new Date();

      const stats = await dashboardService.getEnrollmentStats(testStudyId, startDate, endDate);

      expect(stats).toBeDefined();
      expect(stats.enrollmentByMonth).toBeDefined();
    });

    it('should return active subjects count', async () => {
      const stats = await dashboardService.getEnrollmentStats(testStudyId);

      expect(stats.activeSubjects).toBeDefined();
      expect(typeof stats.activeSubjects).toBe('number');
    });
  });

  describe('getCompletionStats', () => {
    it('should return completion statistics', async () => {
      const stats = await dashboardService.getCompletionStats(testStudyId);

      expect(stats).toBeDefined();
      expect(stats.totalCRFs).toBeDefined();
      expect(typeof stats.totalCRFs).toBe('number');
    });

    it('should calculate completion percentage', async () => {
      const stats = await dashboardService.getCompletionStats(testStudyId);

      expect(stats.completionPercentage).toBeDefined();
      expect(typeof stats.completionPercentage).toBe('number');
      expect(stats.completionPercentage).toBeGreaterThanOrEqual(0);
      expect(stats.completionPercentage).toBeLessThanOrEqual(100);
    });

    it('should return completion by form', async () => {
      const stats = await dashboardService.getCompletionStats(testStudyId);

      expect(stats.completionByForm).toBeDefined();
      expect(Array.isArray(stats.completionByForm)).toBe(true);
    });

    it('should return average completion time', async () => {
      const stats = await dashboardService.getCompletionStats(testStudyId);

      expect(stats.averageCompletionTime).toBeDefined();
      expect(typeof stats.averageCompletionTime).toBe('number');
    });

    it('should handle study with no CRFs', async () => {
      // Create a new empty study
      const emptyStudyId = await createTestStudy(testDb.pool, rootUserId, {
        uniqueIdentifier: `EMPTY-${Date.now()}`
      });

      const stats = await dashboardService.getCompletionStats(emptyStudyId);

      expect(stats.totalCRFs).toBe(0);
      expect(stats.completionPercentage).toBe(0);

      // Cleanup
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [emptyStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [emptyStudyId]);
    });
  });

  describe('getQueryStatistics', () => {
    it('should return query statistics', async () => {
      const stats = await dashboardService.getQueryStatistics(testStudyId);

      expect(stats).toBeDefined();
      expect(stats.totalQueries).toBeDefined();
    });

    it('should return open and closed counts', async () => {
      const stats = await dashboardService.getQueryStatistics(testStudyId);

      expect(stats.openQueries).toBeDefined();
      expect(stats.closedQueries).toBeDefined();
    });

    it('should return queries by type', async () => {
      const stats = await dashboardService.getQueryStatistics(testStudyId);

      expect(stats.queriesByType).toBeDefined();
      expect(Array.isArray(stats.queriesByType)).toBe(true);
    });

    it('should return queries by status', async () => {
      const stats = await dashboardService.getQueryStatistics(testStudyId);

      expect(stats.queriesByStatus).toBeDefined();
      expect(Array.isArray(stats.queriesByStatus)).toBe(true);
    });

    it('should calculate query rate', async () => {
      const stats = await dashboardService.getQueryStatistics(testStudyId);

      expect(stats.queryRate).toBeDefined();
      expect(typeof stats.queryRate).toBe('number');
    });

    it('should respect timeframe parameter', async () => {
      const weekStats = await dashboardService.getQueryStatistics(testStudyId, 'week');
      const monthStats = await dashboardService.getQueryStatistics(testStudyId, 'month');

      expect(weekStats).toBeDefined();
      expect(monthStats).toBeDefined();
    });

    it('should handle all timeframe options', async () => {
      const weekStats = await dashboardService.getQueryStatistics(testStudyId, 'week');
      const quarterStats = await dashboardService.getQueryStatistics(testStudyId, 'quarter');
      const yearStats = await dashboardService.getQueryStatistics(testStudyId, 'year');

      expect(weekStats).toBeDefined();
      expect(quarterStats).toBeDefined();
      expect(yearStats).toBeDefined();
    });
  });

  describe('getUserActivityStats', () => {
    it('should return user activity statistics', async () => {
      const stats = await dashboardService.getUserActivityStats(testStudyId, 30);

      expect(stats).toBeDefined();
      expect(stats.activeUsers).toBeDefined();
    });

    it('should count active users', async () => {
      const stats = await dashboardService.getUserActivityStats(testStudyId, 30);

      expect(typeof stats.activeUsers).toBe('number');
    });

    it('should count total logins', async () => {
      const stats = await dashboardService.getUserActivityStats(testStudyId, 30);

      expect(stats.totalLogins).toBeDefined();
      expect(typeof stats.totalLogins).toBe('number');
    });

    it('should return activity by user', async () => {
      const stats = await dashboardService.getUserActivityStats(testStudyId, 30);

      expect(stats.activityByUser).toBeDefined();
      expect(Array.isArray(stats.activityByUser)).toBe(true);
    });

    it('should return activity by day', async () => {
      const stats = await dashboardService.getUserActivityStats(testStudyId, 30);

      expect(stats.activityByDay).toBeDefined();
      expect(Array.isArray(stats.activityByDay)).toBe(true);
    });

    it('should respect days parameter', async () => {
      const stats7Days = await dashboardService.getUserActivityStats(testStudyId, 7);
      const stats30Days = await dashboardService.getUserActivityStats(testStudyId, 30);

      // Both should return valid results
      expect(stats7Days).toBeDefined();
      expect(stats30Days).toBeDefined();
    });

    it('should use default 30 days', async () => {
      const stats = await dashboardService.getUserActivityStats(testStudyId);

      expect(stats).toBeDefined();
    });
  });

  describe('getStudyProgress', () => {
    it('should return combined study progress', async () => {
      const progress = await dashboardService.getStudyProgress(testStudyId);

      expect(progress).toBeDefined();
      expect(progress.studyId).toBe(testStudyId);
    });

    it('should include enrollment stats', async () => {
      const progress = await dashboardService.getStudyProgress(testStudyId);

      expect(progress.enrollment).toBeDefined();
      expect(progress.enrollment.totalSubjects).toBeDefined();
    });

    it('should include completion stats', async () => {
      const progress = await dashboardService.getStudyProgress(testStudyId);

      expect(progress.completion).toBeDefined();
      expect(progress.completion.completionPercentage).toBeDefined();
    });

    it('should include query stats', async () => {
      const progress = await dashboardService.getStudyProgress(testStudyId);

      expect(progress.queries).toBeDefined();
      expect(progress.queries.totalQueries).toBeDefined();
    });

    it('should calculate overall progress', async () => {
      const progress = await dashboardService.getStudyProgress(testStudyId);

      expect(progress.overallProgress).toBeDefined();
      expect(typeof progress.overallProgress).toBe('number');
    });

    it('should include last updated timestamp', async () => {
      const progress = await dashboardService.getStudyProgress(testStudyId);

      expect(progress.lastUpdated).toBeDefined();
      expect(progress.lastUpdated instanceof Date).toBe(true);
    });

    it('should calculate enrollment progress if target set', async () => {
      await testDb.pool.query('UPDATE study SET expected_total_enrollment = 100 WHERE study_id = $1', [testStudyId]);

      const progress = await dashboardService.getStudyProgress(testStudyId);

      expect(progress.enrollmentProgress).toBeDefined();
      expect(typeof progress.enrollmentProgress).toBe('number');
    });
  });
});


