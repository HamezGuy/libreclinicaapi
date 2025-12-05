/**
 * Password Utility
 * 
 * Password hashing, validation, and complexity checks
 * - MD5 hashing for LibreClinica compatibility
 * - Password complexity validation (21 CFR Part 11)
 * - Password expiration checking
 * - Account lockout management
 * 
 * Compliance: 21 CFR Part 11 §11.300 - Password Controls
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { config } from '../config/environment';
import { logger } from '../config/logger';

/**
 * Password validation result
 */
export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Password policy configuration
 */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecialChar: boolean;
  expirationDays: number;
  preventReuse: number; // Number of previous passwords to check
}

/**
 * Default password policy - 8 chars + 1 special character
 */
const DEFAULT_POLICY: PasswordPolicy = {
  minLength: config.part11.passwordMinLength || 8,
  requireUppercase: false,
  requireLowercase: false,
  requireNumber: false,
  requireSpecialChar: true,  // Require at least 1 special character
  expirationDays: config.part11.passwordExpiryDays || 365,
  preventReuse: 0
};

/**
 * Hash password using MD5 (LibreClinica compatibility)
 * LibreClinica uses MD5 for password storage
 * 
 * Note: MD5 is not recommended for new systems, but we need
 * compatibility with existing LibreClinica authentication
 */
export const hashPasswordMD5 = (password: string): string => {
  const hash = crypto.createHash('md5');
  hash.update(password);
  return hash.digest('hex');
};

/**
 * Hash password using bcrypt (for new/extended features)
 * More secure than MD5, use for additional API security
 */
export const hashPasswordBcrypt = async (password: string): Promise<string> => {
  const saltRounds = 10;
  const hash = await bcrypt.hash(password, saltRounds);
  return hash;
};

/**
 * Compare password with MD5 hash
 * For LibreClinica authentication
 */
export const comparePasswordMD5 = (password: string, hash: string): boolean => {
  const passwordHash = hashPasswordMD5(password);
  return passwordHash === hash;
};

/**
 * Compare password with bcrypt hash
 * For additional API authentication
 */
export const comparePasswordBcrypt = async (
  password: string,
  hash: string
): Promise<boolean> => {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error: any) {
    logger.error('Password comparison error', { error: error.message });
    return false;
  }
};

/**
 * Validate password against policy
 * Returns validation result with specific error messages
 * SIMPLIFIED - Only basic length check by default
 */
export const validatePassword = (
  password: string,
  policy: PasswordPolicy = DEFAULT_POLICY
): PasswordValidationResult => {
  const errors: string[] = [];

  // Check minimum length only
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  }

  // Optional checks - only if enabled in policy
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (policy.requireNumber && !/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (policy.requireSpecialChar && !/[@$!%*?&#^()_+=\-]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Check if password is expired
 * Based on password change date and policy expiration days
 */
export const isPasswordExpired = (
  passwordChangedDate: Date,
  policy: PasswordPolicy = DEFAULT_POLICY
): boolean => {
  const now = new Date();
  const expirationDate = new Date(passwordChangedDate);
  expirationDate.setDate(expirationDate.getDate() + policy.expirationDays);

  return now > expirationDate;
};

/**
 * Get days until password expires
 */
export const getDaysUntilPasswordExpires = (
  passwordChangedDate: Date,
  policy: PasswordPolicy = DEFAULT_POLICY
): number => {
  const now = new Date();
  const expirationDate = new Date(passwordChangedDate);
  expirationDate.setDate(expirationDate.getDate() + policy.expirationDays);

  const diffTime = expirationDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays > 0 ? diffDays : 0;
};

/**
 * Check if password was previously used
 * Prevents password reuse
 */
export const isPasswordPreviouslyUsed = (
  password: string,
  previousPasswordHashes: string[]
): boolean => {
  const passwordHash = hashPasswordMD5(password);
  return previousPasswordHashes.includes(passwordHash);
};

/**
 * Generate random password
 * Useful for temporary passwords or password reset
 */
export const generateRandomPassword = (
  length: number = 16,
  includeSpecialChars: boolean = true
): string => {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const specialChars = '@$!%*?&';

  let charset = uppercase + lowercase + numbers;
  if (includeSpecialChars) {
    charset += specialChars;
  }

  let password = '';
  
  // Ensure at least one character from each required set
  password += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
  password += lowercase.charAt(Math.floor(Math.random() * lowercase.length));
  password += numbers.charAt(Math.floor(Math.random() * numbers.length));
  
  if (includeSpecialChars) {
    password += specialChars.charAt(Math.floor(Math.random() * specialChars.length));
  }

  // Fill remaining length with random characters
  for (let i = password.length; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }

  // Shuffle the password
  password = password.split('').sort(() => Math.random() - 0.5).join('');

  return password;
};

/**
 * Check account lockout status
 * Returns true if account should be locked due to failed login attempts
 */
export const shouldLockAccount = (
  failedAttempts: number,
  maxAttempts: number = config.part11.maxLoginAttempts || 5
): boolean => {
  return failedAttempts >= maxAttempts;
};

/**
 * Calculate lockout duration
 * Returns lockout duration in minutes based on failed attempts
 */
export const calculateLockoutDuration = (failedAttempts: number): number => {
  // Progressive lockout: 15, 30, 60, 120 minutes
  if (failedAttempts <= 5) return 15;
  if (failedAttempts <= 10) return 30;
  if (failedAttempts <= 15) return 60;
  return 120; // 2 hours for repeated attempts
};

/**
 * Check if account lockout has expired
 */
export const isLockoutExpired = (
  lockoutUntil: Date | null
): boolean => {
  if (!lockoutUntil) return true;
  return new Date() > new Date(lockoutUntil);
};

/**
 * Sanitize password for logging
 * Never log actual passwords
 */
export const sanitizePasswordForLog = (password: string): string => {
  return '***REDACTED***';
};

/**
 * Calculate password strength
 * Returns score from 0 (weak) to 100 (strong)
 */
export const calculatePasswordStrength = (password: string): number => {
  let score = 0;

  // Length score (up to 30 points)
  score += Math.min(password.length * 2, 30);

  // Character variety (up to 40 points)
  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/\d/.test(password)) score += 10;
  if (/[@$!%*?&]/.test(password)) score += 10;

  // Additional complexity (up to 30 points)
  const uniqueChars = new Set(password).size;
  score += Math.min(uniqueChars, 15);

  // Penalty for patterns
  if (/(.)\1{2,}/.test(password)) score -= 10;
  if (/(?:123|abc|qwe)/i.test(password)) score -= 10;

  return Math.max(0, Math.min(100, score));
};

/**
 * Get password strength label
 */
export const getPasswordStrengthLabel = (score: number): string => {
  if (score < 30) return 'Weak';
  if (score < 60) return 'Fair';
  if (score < 80) return 'Good';
  return 'Strong';
};

export default {
  hashPasswordMD5,
  hashPasswordBcrypt,
  comparePasswordMD5,
  comparePasswordBcrypt,
  validatePassword,
  isPasswordExpired,
  getDaysUntilPasswordExpires,
  isPasswordPreviouslyUsed,
  generateRandomPassword,
  shouldLockAccount,
  calculateLockoutDuration,
  isLockoutExpired,
  calculatePasswordStrength,
  getPasswordStrengthLabel
};

