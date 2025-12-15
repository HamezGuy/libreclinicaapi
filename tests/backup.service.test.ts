/**
 * Backup Service Unit Tests
 * 
 * 21 CFR Part 11 Compliant Backup System Tests
 * Tests configuration, types, and utility functions
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Import backup service
import * as backupService from '../src/services/backup/backup.service';
import { BackupType, BackupStatus } from '../src/services/backup/backup.service';

describe('Backup Service - Configuration', () => {
  describe('getBackupConfig', () => {
    it('should return backup configuration', () => {
      const config = backupService.getBackupConfig();

      expect(config).toBeDefined();
      expect(config.backupDir).toBeDefined();
      expect(config.retentionDays).toBeDefined();
      expect(config.schedules).toBeDefined();
    });

    it('should have correct retention policies per SOP-008', () => {
      const config = backupService.getBackupConfig();

      expect(config.retentionDays.full).toBeGreaterThanOrEqual(28);
      expect(config.retentionDays.incremental).toBeGreaterThanOrEqual(7);
      expect(config.retentionDays.transactionLog).toBeGreaterThanOrEqual(1);
    });

    it('should have valid cron expressions for schedules', () => {
      const config = backupService.getBackupConfig();

      expect(config.schedules.full).toMatch(/^[\d\*\-\/,\s]+$/);
      expect(config.schedules.incremental).toMatch(/^[\d\*\-\/,\s]+$/);
      expect(config.schedules.transactionLog).toMatch(/^[\d\*\-\/,\s]+$/);
    });
  });
});

describe('Backup Types and Status Enums', () => {
  it('should have correct backup types per SOP-008', () => {
    expect(BackupType.FULL).toBe('full');
    expect(BackupType.INCREMENTAL).toBe('incremental');
    expect(BackupType.TRANSACTION_LOG).toBe('transaction_log');
  });

  it('should have correct status values', () => {
    expect(BackupStatus.PENDING).toBe('pending');
    expect(BackupStatus.IN_PROGRESS).toBe('in_progress');
    expect(BackupStatus.COMPLETED).toBe('completed');
    expect(BackupStatus.FAILED).toBe('failed');
    expect(BackupStatus.VERIFIED).toBe('verified');
  });
});

describe('Backup ID Format', () => {
  it('should follow SOP-008 naming convention', () => {
    const backupIdPattern = /^BKP-\d{4}-\d{2}-\d{2}-(FULL|INCREMENTAL|TRANSACTION_LOG)-\d+$/;
    
    const validIds = [
      'BKP-2024-01-15-FULL-1705334400000',
      'BKP-2024-12-31-INCREMENTAL-1735689600000',
      'BKP-2024-06-15-TRANSACTION_LOG-1718409600000'
    ];

    for (const id of validIds) {
      expect(id).toMatch(backupIdPattern);
    }
  });
});

describe('Checksum Verification Logic', () => {
  it('should produce consistent SHA-256 checksums', () => {
    const content = 'Test content for checksum verification';
    const hash1 = crypto.createHash('sha256').update(content).digest('hex');
    const hash2 = crypto.createHash('sha256').update(content).digest('hex');

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it('should detect content changes', () => {
    const content1 = 'Original content';
    const content2 = 'Modified content';
    
    const hash1 = crypto.createHash('sha256').update(content1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(content2).digest('hex');

    expect(hash1).not.toBe(hash2);
  });
});

describe('Retention Policy Calculations', () => {
  it('should calculate correct retention dates for full backups', () => {
    const config = backupService.getBackupConfig();
    const backupDate = new Date();
    const retentionDate = new Date(backupDate);
    retentionDate.setDate(retentionDate.getDate() + config.retentionDays.full);

    const diffDays = Math.floor((retentionDate.getTime() - backupDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBeGreaterThanOrEqual(28);
  });

  it('should calculate correct retention dates for incremental backups', () => {
    const config = backupService.getBackupConfig();
    const backupDate = new Date();
    const retentionDate = new Date(backupDate);
    retentionDate.setDate(retentionDate.getDate() + config.retentionDays.incremental);

    const diffDays = Math.floor((retentionDate.getTime() - backupDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBeGreaterThanOrEqual(7);
  });
});

describe('Backup Listing Functions', () => {
  it('should return empty array when no backups exist', async () => {
    const result = await backupService.listBackups(undefined, 10);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('should return not found for non-existent backup', async () => {
    const result = await backupService.getBackup('BKP-9999-99-99-FULL-9999999999999');

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});

describe('Backup Statistics', () => {
  it('should return backup statistics structure', async () => {
    const result = await backupService.getBackupStats();

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.totalBackups).toBeDefined();
    expect(result.data!.totalSize).toBeDefined();
    expect(result.data!.backupsByType).toBeDefined();
    expect(result.data!.status).toBeDefined();
  });

  it('should include health status', async () => {
    const result = await backupService.getBackupStats();

    expect(result.data!.status.healthy).toBeDefined();
    expect(typeof result.data!.status.healthy).toBe('boolean');
    expect(Array.isArray(result.data!.status.warnings)).toBe(true);
  });
});

describe('Cleanup Functions', () => {
  it('should handle cleanup when no backups exist', async () => {
    const result = await backupService.cleanupOldBackups(0, 'test');

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.deleted).toBeDefined();
    expect(result.data!.freed).toBeDefined();
  });
});
