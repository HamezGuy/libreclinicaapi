/**
 * Encryption Service - 21 CFR Part 11 & HIPAA Compliant
 * 
 * Implements AES-256-GCM encryption for backup files.
 * 
 * HIPAA §164.312(a)(2)(iv): Encryption and decryption
 * 21 CFR Part 11 §11.10(c): Protection of records
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { logger } from '../../config/logger';

// Constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Encryption configuration interface
 */
export interface EncryptionConfig {
  algorithm: 'aes-256-gcm';
  keySource: 'env' | 'aws-kms' | 'azure-keyvault';
  keyId: string;
}

/**
 * Encrypted file metadata
 */
export interface EncryptedFileMetadata {
  encryptedPath: string;
  iv: string;           // Base64 encoded
  authTag: string;      // Base64 encoded
  keyId: string;
  originalChecksum: string;
  encryptedChecksum: string;
  originalSize: number;
  encryptedSize: number;
  encryptedAt: string;
  algorithm: string;
}

/**
 * Encryption result
 */
export interface EncryptionResult {
  success: boolean;
  metadata?: EncryptedFileMetadata;
  error?: string;
}

/**
 * Get encryption key from configured source
 * 
 * For production, use AWS KMS or Azure Key Vault
 * For development/testing, use environment variable
 */
export const getEncryptionKey = async (keySource: string = 'env'): Promise<Buffer> => {
  switch (keySource) {
    case 'env': {
      const keyHex = process.env.BACKUP_ENCRYPTION_KEY;
      
      // If no key configured, generate a warning but don't fail
      // This allows the system to work without encryption in dev
      if (!keyHex) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('BACKUP_ENCRYPTION_KEY must be set in production');
        }
        logger.warn('BACKUP_ENCRYPTION_KEY not set - using derived key (NOT FOR PRODUCTION)');
        // Derive a key from a known value for dev/test
        return crypto.scryptSync('dev-backup-key', 'edc-salt', KEY_LENGTH);
      }
      
      if (keyHex.length !== 64) {
        throw new Error('BACKUP_ENCRYPTION_KEY must be a 64-character hex string (256 bits)');
      }
      
      return Buffer.from(keyHex, 'hex');
    }
    
    case 'aws-kms': {
      // AWS KMS integration - placeholder for future implementation
      // Would use @aws-sdk/client-kms to decrypt a data key
      logger.warn('AWS KMS integration not yet implemented, falling back to env');
      return getEncryptionKey('env');
    }
    
    case 'azure-keyvault': {
      // Azure Key Vault integration - placeholder for future implementation
      logger.warn('Azure Key Vault integration not yet implemented, falling back to env');
      return getEncryptionKey('env');
    }
    
    default:
      throw new Error(`Unknown key source: ${keySource}`);
  }
};

/**
 * Calculate SHA-256 checksum of a file
 */
export const calculateFileChecksum = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};

/**
 * Encrypt a backup file using AES-256-GCM
 * 
 * @param inputPath - Path to the unencrypted backup file
 * @param outputPath - Optional path for encrypted output (defaults to inputPath + '.enc')
 * @param keySource - Source of encryption key ('env', 'aws-kms', 'azure-keyvault')
 * @returns Encryption result with metadata
 */
export const encryptBackupFile = async (
  inputPath: string,
  outputPath?: string,
  keySource: string = 'env'
): Promise<EncryptionResult> => {
  const startTime = Date.now();
  
  logger.info('Starting backup file encryption', { 
    inputPath, 
    keySource,
    outputPath: outputPath || `${inputPath}.enc`
  });
  
  try {
    // Verify input file exists
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    
    const encryptedPath = outputPath || `${inputPath}.enc`;
    const key = await getEncryptionKey(keySource);
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Get original file stats and checksum
    const originalStats = fs.statSync(inputPath);
    const originalChecksum = await calculateFileChecksum(inputPath);
    
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    // Create read and write streams
    const input = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(encryptedPath);
    
    // Pipe through cipher
    await pipeline(input, cipher, output);
    
    // Get auth tag after encryption is complete
    const authTag = cipher.getAuthTag();
    
    // Get encrypted file stats and checksum
    const encryptedStats = fs.statSync(encryptedPath);
    const encryptedChecksum = await calculateFileChecksum(encryptedPath);
    
    // Create metadata
    const metadata: EncryptedFileMetadata = {
      encryptedPath,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyId: process.env.BACKUP_ENCRYPTION_KEY_ID || 'default-key',
      originalChecksum,
      encryptedChecksum,
      originalSize: originalStats.size,
      encryptedSize: encryptedStats.size,
      encryptedAt: new Date().toISOString(),
      algorithm: ALGORITHM
    };
    
    // Save metadata to sidecar file
    const metadataPath = `${encryptedPath}.meta.json`;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    // Optionally delete original unencrypted file
    if (process.env.DELETE_UNENCRYPTED_BACKUPS === 'true') {
      fs.unlinkSync(inputPath);
      logger.info('Deleted unencrypted backup file after encryption', { inputPath });
    }
    
    const duration = Date.now() - startTime;
    
    logger.info('Backup file encrypted successfully', {
      encryptedPath,
      originalSize: originalStats.size,
      encryptedSize: encryptedStats.size,
      durationMs: duration
    });
    
    return {
      success: true,
      metadata
    };
    
  } catch (error: any) {
    logger.error('Backup file encryption failed', { 
      inputPath, 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Decrypt a backup file
 * 
 * @param encryptedPath - Path to the encrypted backup file
 * @param outputPath - Optional path for decrypted output
 * @param keySource - Source of decryption key
 * @returns Path to decrypted file
 */
export const decryptBackupFile = async (
  encryptedPath: string,
  outputPath?: string,
  keySource: string = 'env'
): Promise<{ success: boolean; decryptedPath?: string; error?: string }> => {
  const startTime = Date.now();
  
  logger.info('Starting backup file decryption', { encryptedPath });
  
  try {
    // Read metadata
    const metadataPath = `${encryptedPath}.meta.json`;
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Encryption metadata not found: ${metadataPath}`);
    }
    
    const metadata: EncryptedFileMetadata = JSON.parse(
      fs.readFileSync(metadataPath, 'utf-8')
    );
    
    // Determine output path
    const decryptedPath = outputPath || encryptedPath.replace('.enc', '.decrypted');
    
    // Get decryption key
    const key = await getEncryptionKey(keySource);
    const iv = Buffer.from(metadata.iv, 'base64');
    const authTag = Buffer.from(metadata.authTag, 'base64');
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    // Create streams
    const input = fs.createReadStream(encryptedPath);
    const output = fs.createWriteStream(decryptedPath);
    
    // Pipe through decipher
    await pipeline(input, decipher, output);
    
    // Verify checksum
    const decryptedChecksum = await calculateFileChecksum(decryptedPath);
    if (decryptedChecksum !== metadata.originalChecksum) {
      // Delete invalid decrypted file
      fs.unlinkSync(decryptedPath);
      throw new Error('Decryption verification failed: checksum mismatch');
    }
    
    const duration = Date.now() - startTime;
    
    logger.info('Backup file decrypted and verified successfully', {
      decryptedPath,
      durationMs: duration
    });
    
    return {
      success: true,
      decryptedPath
    };
    
  } catch (error: any) {
    logger.error('Backup file decryption failed', { 
      encryptedPath, 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Verify encrypted file integrity without decrypting
 * 
 * @param encryptedPath - Path to encrypted file
 * @returns Verification result
 */
export const verifyEncryptedFile = async (
  encryptedPath: string
): Promise<{ valid: boolean; error?: string }> => {
  try {
    const metadataPath = `${encryptedPath}.meta.json`;
    
    if (!fs.existsSync(encryptedPath)) {
      return { valid: false, error: 'Encrypted file not found' };
    }
    
    if (!fs.existsSync(metadataPath)) {
      return { valid: false, error: 'Metadata file not found' };
    }
    
    const metadata: EncryptedFileMetadata = JSON.parse(
      fs.readFileSync(metadataPath, 'utf-8')
    );
    
    // Verify encrypted file checksum
    const currentChecksum = await calculateFileChecksum(encryptedPath);
    if (currentChecksum !== metadata.encryptedChecksum) {
      return { valid: false, error: 'Encrypted file checksum mismatch - file may be corrupted' };
    }
    
    // Verify file size
    const stats = fs.statSync(encryptedPath);
    if (stats.size !== metadata.encryptedSize) {
      return { valid: false, error: 'Encrypted file size mismatch' };
    }
    
    return { valid: true };
    
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
};

/**
 * Generate a new encryption key (for initial setup)
 * 
 * @returns 64-character hex string (256 bits)
 */
export const generateEncryptionKey = (): string => {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
};

/**
 * Check if encryption is enabled
 */
export const isEncryptionEnabled = (): boolean => {
  return process.env.BACKUP_ENCRYPTION_ENABLED === 'true';
};

/**
 * Get encryption configuration status
 */
export const getEncryptionStatus = (): {
  enabled: boolean;
  keyConfigured: boolean;
  keySource: string;
  keyId: string;
} => {
  return {
    enabled: isEncryptionEnabled(),
    keyConfigured: !!process.env.BACKUP_ENCRYPTION_KEY,
    keySource: process.env.BACKUP_ENCRYPTION_KEY_SOURCE || 'env',
    keyId: process.env.BACKUP_ENCRYPTION_KEY_ID || 'default-key'
  };
};

export default {
  encryptBackupFile,
  decryptBackupFile,
  verifyEncryptedFile,
  generateEncryptionKey,
  calculateFileChecksum,
  isEncryptionEnabled,
  getEncryptionStatus,
  getEncryptionKey
};
