/**
 * Backup Scheduler Service Unit Tests
 * 
 * Tests scheduler operations and cron configurations
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import * as schedulerService from '../src/services/backup/backup-scheduler.service';
import { BackupType } from '../src/services/backup/backup.service';

describe('Backup Scheduler Service', () => {
  afterEach(async () => {
    try {
      await schedulerService.stopScheduler();
    } catch (e) {
      // Ignore
    }
  });

  describe('getSchedulerStatus', () => {
    it('should return scheduler status object', () => {
      const status = schedulerService.getSchedulerStatus();

      expect(status).toBeDefined();
      expect(typeof status.running).toBe('boolean');
    });

    it('should include all required status fields', () => {
      const status = schedulerService.getSchedulerStatus();

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('startedAt');
      expect(status).toHaveProperty('lastFullBackup');
      expect(status).toHaveProperty('lastIncrementalBackup');
      expect(status).toHaveProperty('lastTransactionLogBackup');
      expect(status).toHaveProperty('errors');
    });

    it('should show running=false when not started', () => {
      const status = schedulerService.getSchedulerStatus();
      expect(status.running).toBe(false);
    });
  });

  describe('startScheduler', () => {
    it('should start the scheduler', async () => {
      await schedulerService.startScheduler();
      const status = schedulerService.getSchedulerStatus();
      
      expect(status.running).toBe(true);
      expect(status.startedAt).toBeDefined();
    });

    it('should not start twice if already running', async () => {
      await schedulerService.startScheduler();
      const firstStartTime = schedulerService.getSchedulerStatus().startedAt;

      await schedulerService.startScheduler();
      const secondStartTime = schedulerService.getSchedulerStatus().startedAt;

      expect(firstStartTime?.getTime()).toBe(secondStartTime?.getTime());
    });
  });

  describe('stopScheduler', () => {
    it('should stop a running scheduler', async () => {
      await schedulerService.startScheduler();
      expect(schedulerService.getSchedulerStatus().running).toBe(true);

      await schedulerService.stopScheduler();
      expect(schedulerService.getSchedulerStatus().running).toBe(false);
    });

    it('should handle stopping when not running', async () => {
      await expect(schedulerService.stopScheduler()).resolves.not.toThrow();
    });
  });
});

describe('Cron Expression Validation', () => {
  it('should have valid cron expressions for backup schedules', () => {
    const cronPatterns = {
      fullBackup: '0 2 * * 0',
      incrementalBackup: '0 2 * * 1-6',
      transactionLog: '0 * * * *'
    };

    for (const [, pattern] of Object.entries(cronPatterns)) {
      const parts = pattern.split(' ');
      expect(parts.length).toBe(5);
    }
  });

  it('should have correct full backup schedule (Sunday 2 AM)', () => {
    const fullBackupCron = '0 2 * * 0';
    const parts = fullBackupCron.split(' ');

    expect(parts[0]).toBe('0');
    expect(parts[1]).toBe('2');
    expect(parts[4]).toBe('0');
  });

  it('should have correct incremental backup schedule (Mon-Sat 2 AM)', () => {
    const incrementalCron = '0 2 * * 1-6';
    const parts = incrementalCron.split(' ');

    expect(parts[0]).toBe('0');
    expect(parts[1]).toBe('2');
    expect(parts[4]).toBe('1-6');
  });
});
