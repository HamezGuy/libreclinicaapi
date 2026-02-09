/**
 * Encryption Service for Backup
 * 
 * 21 CFR Part 11 §11.10(a) - Data-at-Rest Encryption
 * HIPAA §164.312(a)(2)(iv) - Encryption and decryption
 * 
 * Provides AES-256-GCM encryption for database backup files.
 * Inspired by phi-encryption patterns from the libreclinica project.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;

export interface EncryptionMetadata {
  originalFile: string;
  encryptedFile: string;
  encryptedPath: string;
  salt: string;
  iv: string;
  authTag: string;
  checksum: string;
  algorithm: string;
  encryptedAt: string;
}

export interface EncryptedFileMetadata {
  success: boolean;
  metadata?: EncryptionMetadata;
  error?: string;
}

/**
 * Check if backup encryption is enabled
 */
export function isEncryptionEnabled(): boolean {
  return config.encryption?.enableFieldEncryption === true ||
         process.env.BACKUP_ENCRYPTION_ENABLED === 'true';
}

/**
 * Calculate SHA-256 checksum of a file
 */
export async function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Derive encryption key from master key using PBKDF2
 */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512');
}

/**
 * Encrypt a backup file using AES-256-GCM
 */
export async function encryptBackupFile(
  inputPath: string,
  outputPath?: string
): Promise<EncryptedFileMetadata> {
  try {
    const masterKey = config.encryption?.masterKey || 'change-me-in-production';
    const encryptedPath = outputPath || `${inputPath}.enc`;
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(masterKey, salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const input = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(encryptedPath);

    return new Promise((resolve, reject) => {
      input.pipe(cipher).pipe(output);
      output.on('finish', async () => {
        const authTag = cipher.getAuthTag();
        let checksum = '';
        try {
          checksum = await calculateFileChecksum(encryptedPath);
        } catch (e) {
          // checksum is optional
        }

        const metadata: EncryptionMetadata = {
          originalFile: path.basename(inputPath),
          encryptedFile: path.basename(encryptedPath),
          encryptedPath,
          salt: salt.toString('hex'),
          iv: iv.toString('hex'),
          authTag: authTag.toString('hex'),
          checksum,
          algorithm: ALGORITHM,
          encryptedAt: new Date().toISOString()
        };

        logger.info('Backup file encrypted', {
          originalFile: metadata.originalFile,
          encryptedFile: metadata.encryptedFile
        });

        resolve({ success: true, metadata });
      });
      output.on('error', (err) => resolve({ success: false, error: err.message }));
      input.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Decrypt a backup file
 */
export async function decryptBackupFile(
  inputPath: string,
  outputPath: string,
  metadata: EncryptionMetadata
): Promise<void> {
  const masterKey = config.encryption?.masterKey || 'change-me-in-production';
  const salt = Buffer.from(metadata.salt, 'hex');
  const key = deriveKey(masterKey, salt);
  const iv = Buffer.from(metadata.iv, 'hex');
  const authTag = Buffer.from(metadata.authTag, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    input.pipe(decipher).pipe(output);
    output.on('finish', () => {
      logger.info('Backup file decrypted', { inputPath, outputPath });
      resolve();
    });
    output.on('error', reject);
    input.on('error', reject);
  });
}

export default {
  encryptBackupFile,
  decryptBackupFile,
  isEncryptionEnabled,
  calculateFileChecksum
};
