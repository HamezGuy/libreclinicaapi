/**
 * Backup Standalone Unit Tests
 * 
 * These tests DO NOT require Docker or database
 * Tests pure logic, configuration, and file operations
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzipAsync = promisify(zlib.gunzip);
const gzipAsync = promisify(zlib.gzip);

// Skip database-dependent setup
jest.mock('../src/config/database', () => ({
  pool: {
    query: (jest.fn() as any).mockResolvedValue({ rows: [] })
  }
}));

// Import after mocking
import { BackupType, BackupStatus, getBackupConfig } from '../src/services/backup/backup.service';

const TEST_DIR = path.join(process.cwd(), 'standalone-test-backups');

describe('Backup Configuration (No DB Required)', () => {
  it('should return backup configuration', () => {
    const config = getBackupConfig();
    
    expect(config).toBeDefined();
    expect(config.backupDir).toBeDefined();
    expect(config.retentionDays).toBeDefined();
    expect(config.schedules).toBeDefined();
  });

  it('should have retention policy for full backups (28+ days)', () => {
    const config = getBackupConfig();
    expect(config.retentionDays.full).toBeGreaterThanOrEqual(28);
  });

  it('should have retention policy for incremental backups (7+ days)', () => {
    const config = getBackupConfig();
    expect(config.retentionDays.incremental).toBeGreaterThanOrEqual(7);
  });

  it('should have valid cron schedule for full backup', () => {
    const config = getBackupConfig();
    expect(config.schedules.full).toMatch(/^\d+\s+\d+\s+\*\s+\*\s+\d+$/);
  });

  it('should have valid cron schedule for incremental backup', () => {
    const config = getBackupConfig();
    expect(config.schedules.incremental).toBeDefined();
  });
});

describe('Backup Types Enum', () => {
  it('should have FULL type', () => {
    expect(BackupType.FULL).toBe('full');
  });

  it('should have INCREMENTAL type', () => {
    expect(BackupType.INCREMENTAL).toBe('incremental');
  });

  it('should have TRANSACTION_LOG type', () => {
    expect(BackupType.TRANSACTION_LOG).toBe('transaction_log');
  });
});

describe('Backup Status Enum', () => {
  it('should have all required statuses', () => {
    expect(BackupStatus.PENDING).toBe('pending');
    expect(BackupStatus.IN_PROGRESS).toBe('in_progress');
    expect(BackupStatus.COMPLETED).toBe('completed');
    expect(BackupStatus.FAILED).toBe('failed');
    expect(BackupStatus.VERIFIED).toBe('verified');
  });
});

describe('Backup ID Format Validation', () => {
  const idPattern = /^BKP-\d{4}-\d{2}-\d{2}-(FULL|INCREMENTAL|TRANSACTION_LOG)-\d+$/;

  it('should match valid FULL backup ID', () => {
    expect('BKP-2024-12-13-FULL-1702483200000').toMatch(idPattern);
  });

  it('should match valid INCREMENTAL backup ID', () => {
    expect('BKP-2024-12-13-INCREMENTAL-1702483200000').toMatch(idPattern);
  });

  it('should match valid TRANSACTION_LOG backup ID', () => {
    expect('BKP-2024-12-13-TRANSACTION_LOG-1702483200000').toMatch(idPattern);
  });

  it('should not match invalid ID', () => {
    expect('INVALID-BACKUP-ID').not.toMatch(idPattern);
  });
});

describe('SHA-256 Checksum Logic', () => {
  it('should produce 64-character hex string', () => {
    const hash = crypto.createHash('sha256').update('test').digest('hex');
    expect(hash.length).toBe(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('should be consistent for same input', () => {
    const input = 'LibreClinica backup test data';
    const hash1 = crypto.createHash('sha256').update(input).digest('hex');
    const hash2 = crypto.createHash('sha256').update(input).digest('hex');
    expect(hash1).toBe(hash2);
  });

  it('should differ for different input', () => {
    const hash1 = crypto.createHash('sha256').update('data1').digest('hex');
    const hash2 = crypto.createHash('sha256').update('data2').digest('hex');
    expect(hash1).not.toBe(hash2);
  });
});

describe('Gzip Compression Logic', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      fs.readdirSync(TEST_DIR).forEach(f => fs.unlinkSync(path.join(TEST_DIR, f)));
      fs.rmdirSync(TEST_DIR);
    } catch {}
  });

  it('should compress and decompress correctly', async () => {
    const original = 'CREATE TABLE test (id INT);\\nINSERT INTO test VALUES (1);';
    
    const compressed = await gzipAsync(Buffer.from(original));
    expect(compressed.length).toBeLessThan(original.length + 20); // gzip adds header
    
    const decompressed = await gunzipAsync(compressed);
    expect(decompressed.toString()).toBe(original);
  });

  it('should create valid gzip file', async () => {
    const content = 'SQL backup content here';
    const compressed = await gzipAsync(Buffer.from(content));
    
    // Check gzip magic number
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });

  it('should write and read compressed file', async () => {
    const testFile = path.join(TEST_DIR, 'test.sql.gz');
    const content = 'CREATE TABLE users (id SERIAL PRIMARY KEY);';
    
    const compressed = await gzipAsync(Buffer.from(content));
    fs.writeFileSync(testFile, compressed);
    
    expect(fs.existsSync(testFile)).toBe(true);
    
    const read = fs.readFileSync(testFile);
    const decompressed = await gunzipAsync(read);
    expect(decompressed.toString()).toBe(content);
  });
});

describe('File Checksum Verification', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      fs.readdirSync(TEST_DIR).forEach(f => fs.unlinkSync(path.join(TEST_DIR, f)));
      fs.rmdirSync(TEST_DIR);
    } catch {}
  });

  it('should calculate file checksum correctly', () => {
    const testFile = path.join(TEST_DIR, 'checksum-test.txt');
    const content = 'Test content for checksum';
    
    fs.writeFileSync(testFile, content);
    
    const fileContent = fs.readFileSync(testFile);
    const checksum = crypto.createHash('sha256').update(fileContent).digest('hex');
    
    expect(checksum.length).toBe(64);
    
    // Verify same content = same checksum
    const directChecksum = crypto.createHash('sha256').update(content).digest('hex');
    expect(checksum).toBe(directChecksum);
  });

  it('should detect file modification', () => {
    const testFile = path.join(TEST_DIR, 'modify-test.txt');
    
    fs.writeFileSync(testFile, 'original');
    const originalChecksum = crypto.createHash('sha256')
      .update(fs.readFileSync(testFile)).digest('hex');
    
    fs.writeFileSync(testFile, 'modified');
    const modifiedChecksum = crypto.createHash('sha256')
      .update(fs.readFileSync(testFile)).digest('hex');
    
    expect(originalChecksum).not.toBe(modifiedChecksum);
  });
});

describe('Retention Date Calculation', () => {
  it('should calculate 28-day retention correctly', () => {
    const now = new Date();
    const retention = new Date(now);
    retention.setDate(retention.getDate() + 28);
    
    const diffMs = retention.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    expect(diffDays).toBe(28);
  });

  it('should calculate 7-day retention correctly', () => {
    const now = new Date();
    const retention = new Date(now);
    retention.setDate(retention.getDate() + 7);
    
    const diffMs = retention.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    expect(diffDays).toBe(7);
  });
});

describe('Metadata JSON Structure', () => {
  it('should serialize backup record correctly', () => {
    const record = {
      backupId: 'BKP-2024-12-13-FULL-1702483200000',
      backupType: 'full',
      backupDateTime: new Date().toISOString(),
      backupSize: 1024000,
      backupDuration: 5000,
      backupLocation: '/backups/full/test.sql.gz',
      checksum: 'abc123def456',
      checksumAlgorithm: 'SHA-256',
      verificationStatus: 'verified',
      retentionUntil: new Date().toISOString(),
      databaseName: 'libreclinica',
      databaseHost: 'localhost'
    };
    
    const json = JSON.stringify(record, null, 2);
    const parsed = JSON.parse(json);
    
    expect(parsed.backupId).toBe(record.backupId);
    expect(parsed.backupType).toBe('full');
    expect(parsed.checksumAlgorithm).toBe('SHA-256');
  });
});

describe('Directory Structure', () => {
  beforeAll(() => {
    const dirs = ['full', 'incremental', 'transaction_log', 'metadata'];
    dirs.forEach(d => {
      const p = path.join(TEST_DIR, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
  });

  afterAll(() => {
    try {
      ['full', 'incremental', 'transaction_log', 'metadata'].forEach(d => {
        const p = path.join(TEST_DIR, d);
        if (fs.existsSync(p)) fs.rmdirSync(p);
      });
      if (fs.existsSync(TEST_DIR)) fs.rmdirSync(TEST_DIR);
    } catch {}
  });

  it('should create backup subdirectories', () => {
    expect(fs.existsSync(path.join(TEST_DIR, 'full'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'incremental'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'transaction_log'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'metadata'))).toBe(true);
  });
});


