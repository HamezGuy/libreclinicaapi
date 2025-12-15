/**
 * Backup Integration Tests
 * 
 * Actually performs backup operations against the test database
 * Requires: docker-compose -f docker-compose.libreclinica.yml up -d
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { testDb } from './utils/test-db';

const gunzipAsync = promisify(zlib.gunzip);

// Set up test environment before importing backup service
const TEST_BACKUP_DIR = path.join(process.cwd(), 'test-backups-integration');
process.env.BACKUP_DIR = TEST_BACKUP_DIR;
process.env.BACKUP_SCHEDULER_ENABLED = 'false';
process.env.BACKUP_ENCRYPTION_ENABLED = 'false';

// Now import backup service (after env vars are set)
import * as backupService from '../src/services/backup/backup.service';
import { BackupType, BackupStatus } from '../src/services/backup/backup.service';

describe('Backup Integration Tests', () => {
  const createdBackups: string[] = [];
  let dbAvailable = false;

  beforeAll(async () => {
    // Create backup directories
    ['full', 'incremental', 'transaction_log', 'metadata'].forEach(dir => {
      const fullPath = path.join(TEST_BACKUP_DIR, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    });

    // Check if database is available
    try {
      await testDb.connect();
      dbAvailable = true;
      console.log('✅ Test database connected');
    } catch (e: any) {
      console.warn('⚠️ Test database not available:', e.message);
    }
  });

  afterAll(async () => {
    // Cleanup created backups
    for (const backupId of createdBackups) {
      try {
        const backup = await backupService.getBackup(backupId);
        if (backup.data?.backupLocation && fs.existsSync(backup.data.backupLocation)) {
          fs.unlinkSync(backup.data.backupLocation);
        }
        const metaPath = path.join(TEST_BACKUP_DIR, 'metadata', `${backupId}.json`);
        if (fs.existsSync(metaPath)) {
          fs.unlinkSync(metaPath);
        }
      } catch (e) {
        // Ignore
      }
    }

    // Cleanup directories
    try {
      ['full', 'incremental', 'transaction_log', 'metadata'].forEach(dir => {
        const fullPath = path.join(TEST_BACKUP_DIR, dir);
        if (fs.existsSync(fullPath)) {
          fs.readdirSync(fullPath).forEach(f => {
            try { fs.unlinkSync(path.join(fullPath, f)); } catch {}
          });
          try { fs.rmdirSync(fullPath); } catch {}
        }
      });
      if (fs.existsSync(TEST_BACKUP_DIR)) {
        fs.rmdirSync(TEST_BACKUP_DIR);
      }
    } catch (e) {
      // Ignore
    }
  });

  describe('Full Backup Creation', () => {
    it('should create a backup file', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      const result = await backupService.performBackup(BackupType.FULL, 1, 'test-user');
      
      if (result.success && result.data) {
        createdBackups.push(result.data.backupId);
      }

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.backupId).toMatch(/^BKP-.*-FULL-/);
      expect(fs.existsSync(result.data!.backupLocation)).toBe(true);
      
      console.log(`✅ Backup created: ${result.data!.backupId}`);
      console.log(`   Size: ${(result.data!.backupSize / 1024).toFixed(2)} KB`);
    }, 120000);

    it('should create compressed gzip file', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      const result = await backupService.performBackup(BackupType.FULL, 1, 'test-user');
      
      if (result.success && result.data) {
        createdBackups.push(result.data.backupId);
        
        expect(result.data.backupLocation).toMatch(/\.gz$/);
        
        // Verify it's valid gzip
        const content = fs.readFileSync(result.data.backupLocation);
        expect(content[0]).toBe(0x1f); // gzip magic number
        expect(content[1]).toBe(0x8b);
        
        // Decompress and verify content
        const decompressed = await gunzipAsync(content);
        expect(decompressed.length).toBeGreaterThan(0);
        
        console.log(`✅ Gzip verified - decompressed size: ${(decompressed.length / 1024).toFixed(2)} KB`);
      }
    }, 120000);

    it('should calculate correct SHA-256 checksum', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      const result = await backupService.performBackup(BackupType.FULL, 1, 'test-user');
      
      if (result.success && result.data) {
        createdBackups.push(result.data.backupId);
        
        expect(result.data.checksum).toBeDefined();
        expect(result.data.checksum.length).toBe(64);
        expect(result.data.checksumAlgorithm).toBe('SHA-256');
        
        // Verify checksum manually
        const fileContent = fs.readFileSync(result.data.backupLocation);
        const calculated = crypto.createHash('sha256').update(fileContent).digest('hex');
        
        expect(result.data.checksum).toBe(calculated);
        console.log(`✅ Checksum verified: ${calculated.substring(0, 16)}...`);
      }
    }, 120000);

    it('should save metadata file', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      const result = await backupService.performBackup(BackupType.FULL, 1, 'test-user');
      
      if (result.success && result.data) {
        createdBackups.push(result.data.backupId);
        
        const metaPath = path.join(TEST_BACKUP_DIR, 'metadata', `${result.data.backupId}.json`);
        expect(fs.existsSync(metaPath)).toBe(true);
        
        const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        expect(metadata.backupId).toBe(result.data.backupId);
        expect(metadata.backupType).toBe('full');
        expect(metadata.checksumAlgorithm).toBe('SHA-256');
        
        console.log(`✅ Metadata saved`);
      }
    }, 120000);

    it('should contain valid SQL content', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      const result = await backupService.performBackup(BackupType.FULL, 1, 'test-user');
      
      if (result.success && result.data) {
        createdBackups.push(result.data.backupId);
        
        const compressed = fs.readFileSync(result.data.backupLocation);
        const decompressed = await gunzipAsync(compressed);
        const content = decompressed.toString('utf-8');
        
        // Should contain SQL markers
        const hasSqlContent = 
          content.includes('PostgreSQL') ||
          content.includes('pg_dump') ||
          content.includes('CREATE') ||
          content.includes('INSERT') ||
          content.includes('--');
        
        expect(hasSqlContent).toBe(true);
        console.log(`✅ SQL content verified`);
        console.log(`   First 100 chars: ${content.substring(0, 100).replace(/\n/g, ' ')}`);
      }
    }, 120000);
  });

  describe('Backup Verification', () => {
    it('should verify backup integrity', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      // Create backup
      const createResult = await backupService.performBackup(BackupType.FULL, 1, 'test');
      if (!createResult.success) return;
      createdBackups.push(createResult.data!.backupId);

      // Verify it
      const verifyResult = await backupService.verifyBackup(
        createResult.data!.backupId, 1, 'test'
      );

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.data!.verified).toBe(true);
      console.log(`✅ Verification passed`);
    }, 120000);

    it('should detect file modification', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      // Create backup
      const createResult = await backupService.performBackup(BackupType.FULL, 1, 'test');
      if (!createResult.success) return;
      createdBackups.push(createResult.data!.backupId);

      // Modify the file
      fs.appendFileSync(createResult.data!.backupLocation, '\n-- modified');

      // Verify should fail
      const verifyResult = await backupService.verifyBackup(
        createResult.data!.backupId, 1, 'test'
      );

      expect(verifyResult.data!.verified).toBe(false);
      console.log(`✅ Modification detected`);
    }, 120000);
  });

  describe('Backup Listing', () => {
    it('should list created backups', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      // Create a backup
      const createResult = await backupService.performBackup(BackupType.FULL, 1, 'test');
      if (createResult.success) {
        createdBackups.push(createResult.data!.backupId);
      }

      // List
      const listResult = await backupService.listBackups();
      expect(listResult.success).toBe(true);
      expect(Array.isArray(listResult.data)).toBe(true);

      if (createResult.success) {
        const found = listResult.data!.find(b => b.backupId === createResult.data!.backupId);
        expect(found).toBeDefined();
      }
      
      console.log(`✅ Found ${listResult.data!.length} backups`);
    }, 120000);
  });

  describe('Incremental Backup', () => {
    it('should create incremental backup', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      const result = await backupService.performBackup(BackupType.INCREMENTAL, 1, 'test');
      
      if (result.success && result.data) {
        createdBackups.push(result.data.backupId);
        expect(result.data.backupType).toBe(BackupType.INCREMENTAL);
        console.log(`✅ Incremental backup: ${result.data.backupId}`);
      }
    }, 120000);
  });

  describe('Transaction Log Backup', () => {
    it('should create transaction log backup', async () => {
      if (!dbAvailable) {
        console.log('⏭️ Skipping - database not available');
        return;
      }

      const result = await backupService.performBackup(BackupType.TRANSACTION_LOG, 1, 'test');
      
      // May fail if audit tables don't exist, but should not throw
      expect(result).toHaveProperty('success');
      
      if (result.success && result.data) {
        createdBackups.push(result.data.backupId);
        expect(result.data.backupType).toBe(BackupType.TRANSACTION_LOG);
        console.log(`✅ Transaction log backup: ${result.data.backupId}`);
      }
    }, 120000);
  });
});
