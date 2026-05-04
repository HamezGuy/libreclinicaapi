/**
 * 21 CFR Part 11 Compliance Middleware
 *
 * ONE middleware, ONE DTO, ONE request interface.
 *
 * §11.50  — Electronic signature manifestations
 * §11.10(e) — Audit trail for record changes
 * §11.10(d) — Access controls
 * §11.300  — Controls for identification codes/passwords
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { pool } from '../config/database';
import crypto from 'crypto';
import { verifyAndUpgrade } from '../utils/password.util';
import type { Part11Signature } from '@accura-trial/shared-types';

// ─────────────────────────────────────────────────────────────────────
// TYPED REQUEST — the only request type controllers should ever use
// ─────────────────────────────────────────────────────────────────────

export interface SignedRequest extends Request {
  user: {
    userId: number;
    userName: string;
    username?: string;
    email: string;
    userType: string;
    role: string;
    studyIds?: number[];
    organizationIds?: number[];
  };
  signature: Part11Signature;
  auditId?: string;
}

/**
 * @deprecated Use `SignedRequest` instead.  Kept as an alias so existing
 * `import type { Part11Request }` statements don't break during migration.
 */
export type Part11Request = SignedRequest;

// ─────────────────────────────────────────────────────────────────────
// HELPERS — reusable by controllers
// ─────────────────────────────────────────────────────────────────────

/**
 * Throw inside any controller that REQUIRES a verified signature.
 * Returns the signature DTO so you can destructure it directly:
 *
 *   const { signerId, meaning } = demandSignature(req);
 */
export function demandSignature(req: SignedRequest): Part11Signature {
  if (!req.signature || !req.signature.verified) {
    const err: any = new Error('Electronic signature required (21 CFR Part 11 §11.50)');
    err.status = 403;
    err.code = 'SIGNATURE_REQUIRED';
    throw err;
  }
  return req.signature;
}

// ─────────────────────────────────────────────────────────────────────
// PASSWORD FIELD SCRUBBING
// ─────────────────────────────────────────────────────────────────────

const CREDENTIAL_KEYS = ['password', 'signaturePassword', 'signatureUsername', 'username'] as const;

function stripCredentials(body: Record<string, unknown>): void {
  for (const key of CREDENTIAL_KEYS) {
    delete body[key];
  }
}

// ─────────────────────────────────────────────────────────────────────
// CREDENTIAL VERIFICATION (single implementation)
// ─────────────────────────────────────────────────────────────────────

async function verifyCredentials(
  username: string,
  password: string
): Promise<{ valid: boolean; userId: number | null }> {
  const result = await pool.query(
    `SELECT u.user_id, u.passwd, uae.bcrypt_passwd
     FROM user_account u
     LEFT JOIN user_account_extended uae ON uae.user_id = u.user_id
     WHERE u.user_name = $1 AND u.status_id = 1`,
    [username]
  );

  if (result.rows.length === 0) {
    return { valid: false, userId: null };
  }

  const row = result.rows[0];
  const verification = await verifyAndUpgrade(password, row.passwd, row.bcryptPasswd || null);

  if (verification.shouldUpdateDatabase && verification.upgradedBcryptHash) {
    pool.query(
      `INSERT INTO user_account_extended (user_id, bcrypt_passwd)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET bcrypt_passwd = $2, passwd_upgraded_at = NOW()`,
      [row.userId, verification.upgradedBcryptHash]
    ).catch(() => {});
  }

  return { valid: verification.valid, userId: verification.valid ? row.userId : null };
}

// ─────────────────────────────────────────────────────────────────────
// THE MIDDLEWARE — one function, two modes
// ─────────────────────────────────────────────────────────────────────

export interface Part11Options {
  meaning: string;
  required?: boolean;   // default false (soft gate).  true = 403 if no creds.
}

/**
 * Single Part 11 e-signature middleware.
 *
 * Accepts ANY of these body patterns:
 *   { password }                          — current user signs (JWT identity)
 *   { signaturePassword }                 — current user signs (JWT identity)
 *   { signatureUsername, signaturePassword } — explicit signer
 *
 * After running:
 *   - `req.signature` is a fully typed `Part11Signature`
 *   - all credential fields are stripped from `req.body`
 *
 * @example
 *   // soft gate — controllers that want signatures but tolerate unsigned
 *   router.put('/:id', requirePart11({ meaning: SIGNATURE_MEANINGS.STUDY_UPDATE }), ctrl.update);
 *
 *   // hard gate — blocks without valid credentials
 *   router.post('/dispense', requirePart11({ meaning: 'Kit dispensed', required: true }), ctrl.dispense);
 */
export function requirePart11(opts: Part11Options) {
  const { meaning, required = false } = opts;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const signed = req as SignedRequest;
    const body = req.body || {};

    const effectivePassword: string | undefined =
      body.signaturePassword || body.password || undefined;
    const effectiveUsername: string | undefined =
      body.signatureUsername || body.username || undefined;
    const jwtUsername: string | undefined =
      signed.user?.userName || signed.user?.username || undefined;
    const customMeaning: string | undefined = body.signatureMeaning;

    stripCredentials(body);

    if (!effectivePassword) {
      if (required) {
        res.status(403).json({
          success: false,
          code: 'SIGNATURE_REQUIRED',
          message: `Electronic signature required for this action (21 CFR Part 11 §11.50). Submit with signatureUsername and signaturePassword fields.`,
        });
        return;
      }
      signed.signature = { verified: false, signerId: null, signerUsername: null, meaning };
      next();
      return;
    }

    const resolvedUsername = effectiveUsername || jwtUsername;

    if (!resolvedUsername) {
      res.status(400).json({
        success: false,
        message: 'Cannot verify signature: no username provided. Per §11.200, both identification code and password are required.',
      });
      return;
    }

    if (required && !effectiveUsername) {
      res.status(400).json({
        success: false,
        message: 'Per 21 CFR Part 11 §11.200(a)(1)(ii), both username and password must be explicitly provided for this signing action. Include signatureUsername in your request.',
      });
      return;
    }

    // ── Verify ───────────────────────────────────────────────────────
    try {
      const { valid, userId } = await verifyCredentials(resolvedUsername, effectivePassword);

      if (!valid) {
        logger.warn('Electronic signature failed', {
          username: resolvedUsername,
          path: req.path,
        });
        res.status(401).json({ success: false, message: 'Invalid electronic signature credentials' });
        return;
      }

      signed.signature = {
        verified: true,
        signerId: userId,
        signerUsername: resolvedUsername,
        meaning: customMeaning || meaning,
      };

      logger.info('Electronic signature verified', {
        signerId: userId,
        username: effectiveUsername,
        meaning: signed.signature.meaning,
        path: req.path,
      });

      next();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Signature verification error', { error: msg, path: req.path });
      res.status(500).json({ success: false, message: 'Signature verification failed' });
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// STANDALONE VERIFICATION — for code paths outside Express middleware
// (used by consent.routes.ts inline handlers)
// ─────────────────────────────────────────────────────────────────────

export async function verifyElectronicSignature(
  username: string,
  password: string
): Promise<{ valid: boolean; userId?: number; message?: string }> {
  try {
    const { valid, userId } = await verifyCredentials(username, password);
    if (!valid) return { valid: false, message: 'Invalid password' };
    return { valid: true, userId: userId ?? undefined };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('verifyElectronicSignature error', { error: msg });
    return { valid: false, message: 'Verification failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────
// SIGNATURE MEANINGS — re-export from shared-types for convenience
// ─────────────────────────────────────────────────────────────────────

export { SIGNATURE_MEANINGS as SignatureMeanings } from '@accura-trial/shared-types';

// ─────────────────────────────────────────────────────────────────────
// AUDIT TRAIL — unchanged, kept in this file for co-location
// ─────────────────────────────────────────────────────────────────────

export const Part11EventTypes = {
  TRANSFER_INITIATED: 'TRANSFER_INITIATED',
  TRANSFER_APPROVED: 'TRANSFER_APPROVED',
  TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',
  TRANSFER_CANCELLED: 'TRANSFER_CANCELLED',
  KIT_REGISTERED: 'KIT_REGISTERED',
  KIT_DISPENSED: 'KIT_DISPENSED',
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  SHIPMENT_RECEIVED: 'SHIPMENT_RECEIVED',
  INVENTORY_ALERT_CREATED: 'INVENTORY_ALERT_CREATED',
  INVENTORY_ALERT_ACKNOWLEDGED: 'INVENTORY_ALERT_ACKNOWLEDGED',
  INVENTORY_ALERT_RESOLVED: 'INVENTORY_ALERT_RESOLVED',
  PRO_INSTRUMENT_CREATED: 'PRO_INSTRUMENT_CREATED',
  PRO_ASSIGNMENT_CREATED: 'PRO_ASSIGNMENT_CREATED',
  PRO_REMINDER_SENT: 'PRO_REMINDER_SENT',
  PRO_RESPONSE_SUBMITTED: 'PRO_RESPONSE_SUBMITTED',
  PRO_REMINDER_CREATED: 'PRO_REMINDER_CREATED',
  PRO_REMINDER_CANCELLED: 'PRO_REMINDER_CANCELLED',
  EMAIL_TEMPLATE_UPDATED: 'EMAIL_TEMPLATE_UPDATED',
  CONSENT_DOCUMENT_CREATED: 'CONSENT_DOCUMENT_CREATED',
  CONSENT_SIGNED: 'CONSENT_SIGNED',
} as const;

export function formatPart11Timestamp(date?: Date): string {
  return (date || new Date()).toISOString();
}

export async function recordPart11Audit(
  userId: number,
  username: string,
  eventType: string,
  tableName: string,
  entityId: number | string,
  entityName: string,
  oldValue: unknown,
  newValue: unknown,
  reasonForChange?: string,
  metadata?: { ipAddress?: string; [key: string]: unknown }
): Promise<void> {
  try {
    const oldStr = typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue || '');
    const newStr = typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue || '');
    const eventTypeKey = eventType.split('_')[0] || 'data';

    const hashInput = [
      new Date().toISOString(), userId, tableName, entityId, oldStr, newStr, reasonForChange || ''
    ].join('|');
    const recordHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    let previousHash: string | null = null;
    let hashColumnsExist = true;
    try {
      const prev = await pool.query(
        'SELECT record_hash FROM audit_log_event WHERE record_hash IS NOT NULL ORDER BY audit_id DESC LIMIT 1'
      );
      if (prev.rows.length > 0) previousHash = prev.rows[0].recordHash;
    } catch {
      hashColumnsExist = false;
    }

    const baseColumns = `audit_date, audit_table, user_id, entity_id, entity_name,
                         old_value, new_value, audit_log_event_type_id, reason_for_change`;
    const typeSubquery = `(SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE $7 LIMIT 1)`;
    const entityIdVal = typeof entityId === 'string' ? null : entityId;

    if (hashColumnsExist) {
      await pool.query(
        `INSERT INTO audit_log_event (${baseColumns}, record_hash, previous_hash)
         VALUES (NOW(), $1, $2, $3, $4, $5, $6, ${typeSubquery}, $8, $9, $10)`,
        [tableName, userId, entityIdVal, entityName, oldStr, newStr, eventTypeKey,
         reasonForChange || '', recordHash, previousHash]
      );
    } else {
      await pool.query(
        `INSERT INTO audit_log_event (${baseColumns})
         VALUES (NOW(), $1, $2, $3, $4, $5, $6, ${typeSubquery}, $8)`,
        [tableName, userId, entityIdVal, entityName, oldStr, newStr, eventTypeKey,
         reasonForChange || '']
      );
    }

    logger.info('Part 11 audit event recorded', { eventType, userId, username, tableName, entityId });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to record Part 11 audit event', { error: msg, eventType, userId });
    logger.info('Part 11 audit event (file fallback)', {
      eventType, userId, username, tableName, entityId, entityName,
      oldValue: typeof oldValue === 'object' ? JSON.stringify(oldValue) : oldValue,
      newValue: typeof newValue === 'object' ? JSON.stringify(newValue) : newValue,
      reasonForChange, timestamp: formatPart11Timestamp(), ipAddress: metadata?.ipAddress
    });
  }
}
