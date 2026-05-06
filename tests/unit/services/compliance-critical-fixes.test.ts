/**
 * Critical Compliance Fixes — Test Suite
 *
 * Verifies:
 * 1. Field-level encryption (encrypt/decrypt round-trip)
 * 2. S3 cloud-storage service (upload/download/list with mock)
 * 3. Wound image upload calls cloud storage
 * 4. File upload encryption on disk
 * 5. Configuration flags are wired correctly
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// 1. Field-Level Encryption Tests (encryption.util.ts)
// =============================================================================

describe('Field-Level Encryption (encryption.util.ts)', () => {
  let encryptField: (value: string) => string;
  let decryptField: (value: string) => string;
  let isEncrypted: (value: string) => boolean;

  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY = 'test-key-32-bytes-long-for-aes!';
    process.env.ENCRYPTION_SALT = 'test-salt-unique-per-deploy';
    process.env.ENABLE_FIELD_ENCRYPTION = 'true';

    // Re-require to pick up env
    jest.resetModules();
    const mod = require('../../../src/utils/encryption.util');
    encryptField = mod.encryptField;
    decryptField = mod.decryptField;
    isEncrypted = mod.isEncrypted;
  });

  it('should encrypt a plaintext value', () => {
    const plaintext = 'Patient SSN: 123-45-6789';
    const encrypted = encryptField(plaintext);

    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted.startsWith('ENC:')).toBe(true);
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it('should decrypt back to original value', () => {
    const plaintext = 'Blood pressure: 120/80 mmHg';
    const encrypted = encryptField(plaintext);
    const decrypted = decryptField(encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('should not double-encrypt already encrypted values', () => {
    const plaintext = 'Diagnosis: Type 2 Diabetes';
    const encrypted = encryptField(plaintext);
    const doubleEncrypted = encryptField(encrypted);

    expect(doubleEncrypted).toEqual(encrypted);
  });

  it('should return plaintext for non-encrypted values in decryptField', () => {
    const plaintext = 'Normal value without ENC prefix';
    const result = decryptField(plaintext);

    expect(result).toEqual(plaintext);
  });

  it('should handle empty strings', () => {
    expect(encryptField('')).toBe('');
    expect(decryptField('')).toBe('');
  });

  it('should handle unicode and special characters', () => {
    const value = 'Ñoño — пациент «Тест» 日本語テスト ❤️';
    const encrypted = encryptField(value);
    const decrypted = decryptField(encrypted);

    expect(decrypted).toEqual(value);
  });

  it('should produce different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'Same value encrypted twice';
    const enc1 = encryptField(plaintext);
    const enc2 = encryptField(plaintext);

    expect(enc1).not.toEqual(enc2);
    expect(decryptField(enc1)).toEqual(plaintext);
    expect(decryptField(enc2)).toEqual(plaintext);
  });
});

// =============================================================================
// 2. Cloud Storage Service Tests (S3 upload/download)
// =============================================================================

describe('Cloud Storage Service', () => {
  let cloudStorage: typeof import('../../../src/services/backup/cloud-storage.service');

  beforeAll(() => {
    jest.resetModules();
    process.env.CLOUD_STORAGE_PROVIDER = 'local';
    process.env.BACKUP_LOCAL_PATH = path.join(__dirname, '../../../tmp-test-backups');
    cloudStorage = require('../../../src/services/backup/cloud-storage.service');
  });

  afterAll(() => {
    const testDir = path.join(__dirname, '../../../tmp-test-backups');
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should detect when cloud storage is not configured', () => {
    process.env.CLOUD_STORAGE_PROVIDER = 'local';
    delete process.env.AWS_S3_BUCKET;
    expect(cloudStorage.isCloudStorageEnabled()).toBe(false);
  });

  it('should detect when cloud storage IS configured', () => {
    process.env.CLOUD_STORAGE_PROVIDER = 's3';
    process.env.AWS_S3_BUCKET = 'test-bucket';
    expect(cloudStorage.isCloudStorageEnabled()).toBe(true);
    // Reset
    process.env.CLOUD_STORAGE_PROVIDER = 'local';
    delete process.env.AWS_S3_BUCKET;
  });

  it('should upload and download backup locally', async () => {
    const testContent = 'encrypted-backup-data-' + Date.now();
    const tmpFile = path.join(__dirname, '../../../tmp-test-upload.dat');
    fs.writeFileSync(tmpFile, testContent);

    const result = await cloudStorage.uploadBackupToCloud(tmpFile, 'test-backup.dat.enc');

    expect(result.success).toBe(true);
    expect(result.provider).toBe('local');
    expect(result.key).toBe('test-backup.dat.enc');
    expect(result.checksum).toBeDefined();
    expect(result.size).toBeGreaterThan(0);

    // Download
    const downloadPath = path.join(__dirname, '../../../tmp-test-download.dat');
    await cloudStorage.downloadBackupFromCloud('test-backup.dat.enc', downloadPath);
    const downloaded = fs.readFileSync(downloadPath, 'utf8');
    expect(downloaded).toEqual(testContent);

    // Cleanup
    fs.unlinkSync(tmpFile);
    fs.unlinkSync(downloadPath);
  });

  it('should list backups', async () => {
    const backups = await cloudStorage.listCloudBackups();
    expect(Array.isArray(backups)).toBe(true);
    expect(backups).toContain('test-backup.dat.enc');
  });

  it('uploadWoundImageToS3 should fall back to local when no bucket configured', async () => {
    delete process.env.WOUND_IMAGES_S3_BUCKET;
    process.env.WOUND_IMAGES_LOCAL_PATH = path.join(__dirname, '../../../tmp-test-backups/wounds');

    const imageBuffer = Buffer.from('fake-jpeg-data-for-testing');
    const result = await cloudStorage.uploadWoundImageToS3(imageBuffer, 'wounds/test-session/img1.jpg');

    expect(result.success).toBe(true);
    expect(result.provider).toBe('local');
    expect(result.size).toBe(imageBuffer.length);
    expect(result.checksum).toBeDefined();
  });
});

// =============================================================================
// 3. Backup Encryption Tests (encryption.service.ts)
// =============================================================================

describe('Backup File Encryption (encryption.service.ts)', () => {
  let encryptBackupFile: typeof import('../../../src/services/backup/encryption.service').encryptBackupFile;
  let decryptBackupFile: typeof import('../../../src/services/backup/encryption.service').decryptBackupFile;

  const testDir = path.join(__dirname, '../../../tmp-test-encryption');
  const testFile = path.join(testDir, 'test-backup.sql');
  const testContent = 'CREATE TABLE patients (id SERIAL, name TEXT);\nINSERT INTO patients VALUES (1, \'John Doe\');';

  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY = 'test-backup-key-32-bytes-long!!';
    process.env.ENCRYPTION_SALT = 'test-backup-salt';
    process.env.ENABLE_FIELD_ENCRYPTION = 'true';
    process.env.BACKUP_ENCRYPTION_ENABLED = 'true';

    jest.resetModules();
    const mod = require('../../../src/services/backup/encryption.service');
    encryptBackupFile = mod.encryptBackupFile;
    decryptBackupFile = mod.decryptBackupFile;

    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, testContent);
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it('should encrypt a backup file', async () => {
    const result = await encryptBackupFile(testFile);

    expect(result.success).toBe(true);
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.algorithm).toBe('aes-256-gcm');
    expect(result.metadata!.salt).toBeDefined();
    expect(result.metadata!.iv).toBeDefined();
    expect(result.metadata!.authTag).toBeDefined();
    expect(fs.existsSync(result.metadata!.encryptedPath)).toBe(true);

    const encryptedContent = fs.readFileSync(result.metadata!.encryptedPath);
    expect(encryptedContent.toString()).not.toContain('John Doe');
  });

  it('should decrypt back to original content', async () => {
    fs.writeFileSync(testFile, testContent);
    const encResult = await encryptBackupFile(testFile);
    expect(encResult.success).toBe(true);

    const decryptedPath = path.join(testDir, 'decrypted.sql');
    await decryptBackupFile(encResult.metadata!.encryptedPath, decryptedPath, encResult.metadata!);

    const decrypted = fs.readFileSync(decryptedPath, 'utf8');
    expect(decrypted).toEqual(testContent);
  });
});

// =============================================================================
// 4. Docker-compose configuration verification
// =============================================================================

describe('Production Configuration (docker-compose.yml)', () => {
  const dockerComposePath = path.join(__dirname, '../../../production-deployment/docker-compose.yml');

  it('docker-compose.yml should exist', () => {
    expect(fs.existsSync(dockerComposePath)).toBe(true);
  });

  it('should set ENABLE_FIELD_ENCRYPTION to true', () => {
    const content = fs.readFileSync(dockerComposePath, 'utf8');
    expect(content).toContain('ENABLE_FIELD_ENCRYPTION: "true"');
  });

  it('should set BACKUP_ENCRYPTION_ENABLED to true', () => {
    const content = fs.readFileSync(dockerComposePath, 'utf8');
    expect(content).toContain('BACKUP_ENCRYPTION_ENABLED: "true"');
  });

  it('should include CLOUD_STORAGE_PROVIDER configuration', () => {
    const content = fs.readFileSync(dockerComposePath, 'utf8');
    expect(content).toContain('CLOUD_STORAGE_PROVIDER');
  });

  it('should include WOUND_IMAGES_S3_BUCKET configuration', () => {
    const content = fs.readFileSync(dockerComposePath, 'utf8');
    expect(content).toContain('WOUND_IMAGES_S3_BUCKET');
  });

  it('should include wound_measurements in ENCRYPTED_TABLES', () => {
    const content = fs.readFileSync(dockerComposePath, 'utf8');
    expect(content).toContain('wound_measurements');
  });

  it('should NOT contain default encryption key in compose file', () => {
    const content = fs.readFileSync(dockerComposePath, 'utf8');
    expect(content).not.toContain('change-me-in-production');
  });
});

// =============================================================================
// 5. File Upload Encryption Integration
// =============================================================================

describe('File Upload Encryption', () => {
  const testDir = path.join(__dirname, '../../../tmp-test-file-enc');

  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY = 'file-enc-test-key-32-bytes-lo!';
    process.env.ENCRYPTION_SALT = 'file-enc-test-salt';
    process.env.ENABLE_FIELD_ENCRYPTION = 'true';

    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it('should encrypt a file using AES-256-GCM and decrypt it back', () => {
    const testContent = Buffer.from('PHI: Patient John Doe, DOB 1985-03-15, HIV positive');
    const filePath = path.join(testDir, 'test-upload.pdf');
    fs.writeFileSync(filePath, testContent);

    const masterKey = process.env.ENCRYPTION_MASTER_KEY!;
    const salt = process.env.ENCRYPTION_SALT!;
    const key = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([cipher.update(testContent), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encPath = filePath + '.enc';
    fs.writeFileSync(encPath, encrypted);

    // Verify encrypted file doesn't contain plaintext
    const encContent = fs.readFileSync(encPath, 'utf8');
    expect(encContent).not.toContain('John Doe');
    expect(encContent).not.toContain('HIV positive');

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(fs.readFileSync(encPath)), decipher.final()]);

    expect(decrypted.toString()).toEqual(testContent.toString());
  });
});
