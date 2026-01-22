/**
 * Encryption Utility
 * 
 * Field-level encryption for PHI/PII data
 * 21 CFR Part 11 §11.10(c) - Protection of records
 */

import * as crypto from 'crypto';
import { config } from '../config/environment';
import { logger } from '../config/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// Encrypted field prefix to identify encrypted values
const ENCRYPTED_PREFIX = '$ENC$';

/**
 * Get encryption key from environment
 */
const getEncryptionKey = (): Buffer => {
  const masterKey = config.encryption?.masterKey || 'default-key-change-in-production';
  const salt = config.encryption?.salt || 'default-salt';
  
  // Derive a key using scrypt
  return crypto.scryptSync(masterKey, salt, KEY_LENGTH);
};

/**
 * Check if a value is encrypted
 */
export const isEncrypted = (value: string | null | undefined): boolean => {
  if (!value || typeof value !== 'string') {
    return false;
  }
  return value.startsWith(ENCRYPTED_PREFIX);
};

/**
 * Encrypt a field value
 */
export const encryptField = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== 'string') {
    return value as null;
  }
  
  // Don't double-encrypt
  if (isEncrypted(value)) {
    return value;
  }
  
  // Check if field encryption is enabled
  if (!config.encryption?.enableFieldEncryption) {
    return value;
  }
  
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(value, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    // Format: $ENC$<iv>:<authTag>:<encrypted>
    const encryptedValue = [
      ENCRYPTED_PREFIX,
      iv.toString('base64'),
      ':',
      authTag.toString('base64'),
      ':',
      encrypted
    ].join('');
    
    return encryptedValue;
  } catch (error: any) {
    logger.error('Field encryption failed', { error: error.message });
    // Return original value if encryption fails (for safety)
    return value;
  }
};

/**
 * Decrypt a field value
 */
export const decryptField = (encryptedValue: string | null | undefined): string | null => {
  if (!encryptedValue || typeof encryptedValue !== 'string') {
    return encryptedValue as null;
  }
  
  // Check if value is actually encrypted
  if (!isEncrypted(encryptedValue)) {
    return encryptedValue;
  }
  
  try {
    // Remove prefix and parse components
    const data = encryptedValue.substring(ENCRYPTED_PREFIX.length);
    const [ivBase64, authTagBase64, encrypted] = data.split(':');
    
    if (!ivBase64 || !authTagBase64 || !encrypted) {
      logger.warn('Invalid encrypted field format');
      return encryptedValue;
    }
    
    const key = getEncryptionKey();
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error: any) {
    logger.error('Field decryption failed', { error: error.message });
    // Return null or the original value based on security policy
    return null;
  }
};

/**
 * Encrypt multiple fields in an object
 */
export const encryptFields = <T extends Record<string, any>>(
  obj: T,
  fieldNames: (keyof T)[]
): T => {
  const result = { ...obj };
  
  for (const field of fieldNames) {
    const value = result[field];
    if (typeof value === 'string') {
      (result as any)[field] = encryptField(value);
    }
  }
  
  return result;
};

/**
 * Decrypt multiple fields in an object
 */
export const decryptFields = <T extends Record<string, any>>(
  obj: T,
  fieldNames: (keyof T)[]
): T => {
  const result = { ...obj };
  
  for (const field of fieldNames) {
    const value = result[field];
    if (typeof value === 'string') {
      (result as any)[field] = decryptField(value);
    }
  }
  
  return result;
};

/**
 * Hash a value for searching (one-way)
 */
export const hashForSearch = (value: string): string => {
  const salt = config.encryption?.salt || 'default-salt';
  return crypto.createHash('sha256').update(value + salt).digest('hex');
};

export default {
  encryptField,
  decryptField,
  encryptFields,
  decryptFields,
  isEncrypted,
  hashForSearch
};
