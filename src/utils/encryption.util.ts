/**
 * Field-Level Encryption Utility
 * 
 * 21 CFR Part 11 §11.10(a) - Data-at-Rest Encryption
 * Provides AES-256-GCM encryption for individual form field values.
 * 
 * Used by hybrid/form.service.ts to encrypt/decrypt PHI in item_data.
 * Inspired by phi-encryption patterns from the libreclinica project.
 */

import * as crypto from 'crypto';
import { config } from '../config/environment';
import { logger } from '../config/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'ENC:';

/**
 * Derive a 256-bit key from the master key using PBKDF2
 */
function deriveKey(): Buffer {
  const masterKey = config.encryption?.masterKey || 'change-me-in-production';
  const salt = config.encryption?.salt || 'libreclinica-default-salt-change-me';
  return crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512');
}

/**
 * Encrypt a field value using AES-256-GCM
 * Returns a prefixed string: "ENC:<iv>:<authTag>:<ciphertext>" (all hex)
 */
export function encryptField(value: string): string {
  if (!value || isEncrypted(value)) {
    return value;
  }

  try {
    const key = deriveKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error: any) {
    logger.error('Field encryption failed', { error: error.message });
    return value; // Return plaintext on failure rather than losing data
  }
}

/**
 * Decrypt a field value encrypted with encryptField()
 */
export function decryptField(encryptedValue: string): string {
  if (!encryptedValue || !isEncrypted(encryptedValue)) {
    return encryptedValue;
  }

  try {
    const payload = encryptedValue.substring(ENCRYPTED_PREFIX.length);
    const [ivHex, authTagHex, ciphertext] = payload.split(':');

    if (!ivHex || !authTagHex || !ciphertext) {
      logger.warn('Malformed encrypted field value');
      return encryptedValue;
    }

    const key = deriveKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error: any) {
    logger.error('Field decryption failed', { error: error.message });
    return encryptedValue; // Return encrypted value on failure
  }
}

/**
 * Check if a value is already encrypted (has the ENC: prefix)
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}
