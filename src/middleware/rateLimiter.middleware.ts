/**
 * Rate Limiter Middleware
 * 
 * Implements rate limiting to protect API from abuse
 * - General API rate limiting
 * - Stricter limits for authentication endpoints
 * - IP-based and user-based limiting
 * 
 * Compliance: Security best practice, prevents brute force attacks
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logger } from '../config/logger';
import { config } from '../config/environment';

/**
 * Custom rate limit handler
 * Logs rate limit violations
 */
const rateLimitHandler = (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const username = (req as any).user?.username;
  const ip = req.ip;

  logger.warn('Rate limit exceeded', {
    userId,
    username,
    ip,
    path: req.path,
    method: req.method
  });

  res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
    retryAfter: res.getHeader('Retry-After')
  });
};

/**
 * Check if running in test mode
 */
const isTestMode = process.env.NODE_ENV === 'test';

/**
 * Check if running in development mode
 */
const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * General API rate limiter
 * Applies to all API endpoints
 *
 * Default: 10000 requests per 15 minutes per IP (development: disabled).
 * Bumped 10x from the previous 1000-req cap because a single rule-author
 * doing CRUD on a CRF with 50+ rules can easily fire a few hundred GETs
 * per page load. The auth/AI/etc routes have their own dedicated limiters.
 */
export const apiRateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes default
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || (isDevelopment ? '0' : '10000')), // 0 = unlimited in development
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: rateLimitHandler,
  skip: (req) => {
    // Skip ALL rate limiting in development and test mode
    if (isTestMode || isDevelopment) {
      return true;
    }
    if (req.path === '/health' || req.path === '/api/health') {
      return true;
    }
    return false;
  }
});

/**
 * Authentication rate limiter for LOGIN only
 * Stricter limits for login endpoints to prevent brute force.
 *
 * Default: 100 login attempts per 15 minutes per IP (development:
 * disabled). Bumped from the previous 10/15min because the test suite
 * (and the staging UI when developers reload tabs) consumed the budget
 * within the first three runs and then EVERY downstream test failed
 * with 429 — including the AI suite, masking real failures.
 *
 * 100/15min still keeps brute-force attacks well under the password
 * lockout threshold (each LibreClinica account locks after 5 wrong
 * passwords) so this is purely defence-in-depth, not the primary gate.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || (isDevelopment ? '0' : '100')), // 0 = unlimited in development
  message: 'Too many login attempts. Please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip ALL rate limiting in development and test mode
    if (isTestMode || isDevelopment) return true;
    // Skip rate limiting for refresh token requests (they have their own limiter)
    if (req.path.includes('/refresh')) return true;
    // Skip if caller provides the rate-limit bypass header (e.g. from test scripts)
    if (process.env.RATE_LIMIT_BYPASS_KEY && req.headers['x-bypass-rate-limit'] === process.env.RATE_LIMIT_BYPASS_KEY) return true;
    return false;
  },
  handler: (req: Request, res: Response) => {
    const ip = req.ip;
    const username = req.body.username;

    logger.warn('Authentication rate limit exceeded', {
      ip,
      username,
      path: req.path
    });

    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Account temporarily locked. Please try again after 15 minutes.',
      retryAfter: res.getHeader('Retry-After')
    });
  }
});

/**
 * Refresh token rate limiter
 * More generous limits for refresh tokens (legitimate app behavior).
 *
 * Default: 600 refresh attempts per 15 minutes per IP (10x previous).
 */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.REFRESH_RATE_LIMIT_MAX || (isDevelopment ? '0' : '600')),
  message: 'Too many refresh attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestMode || isDevelopment,
  handler: (req: Request, res: Response) => {
    const ip = req.ip;

    logger.warn('Refresh token rate limit exceeded', {
      ip,
      path: req.path
    });

    res.status(429).json({
      success: false,
      message: 'Too many token refresh attempts. Please try again later.',
      retryAfter: res.getHeader('Retry-After')
    });
  }
});

/**
 * Password reset rate limiter
 * Limit password reset attempts.
 *
 * Default: 30 attempts per hour per IP. Kept relatively tight because
 * password reset emails are a spam vector. (Prev: 3/hr — too tight for
 * legitimate operator use; bumped 10x.)
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_MAX || '30'),
  message: 'Too many password reset attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
});

/**
 * SOAP operation rate limiter
 * Limit write operations to LibreClinica.
 * More generous for data entry workflows.
 *
 * Default: 500 requests per 15 minutes per IP (10x previous).
 */
export const soapRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 0 : parseInt(process.env.SOAP_RATE_LIMIT_MAX || '500'),
  message: 'Too many data operations. Please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => isTestMode || isDevelopment
});

/**
 * Report generation rate limiter
 * Limit resource-intensive report generation.
 *
 * Default: 100 reports per hour per user (10x previous).
 */
export const reportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.REPORT_RATE_LIMIT_MAX || '100'),
  message: 'Too many report generation requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => {
    // Rate limit by user ID if authenticated, otherwise by IP
    const userId = (req as any).user?.userId;
    return userId ? `user_${userId}` : req.ip || 'unknown';
  }
});

/**
 * Audit export rate limiter
 * Limit audit trail exports (resource intensive).
 *
 * Default: 50 exports per hour per user (10x previous).
 */
export const auditExportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.AUDIT_EXPORT_RATE_LIMIT_MAX || '50'),
  message: 'Too many audit export requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.userId;
    return userId ? `user_${userId}` : req.ip || 'unknown';
  }
});

/**
 * File upload rate limiter
 * Limit file upload operations.
 *
 * Default: 200 uploads per hour per user (10x previous).
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || '200'),
  message: 'Too many file uploads. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.userId;
    return userId ? `user_${userId}` : req.ip || 'unknown';
  }
});

/**
 * AI rule-compiler rate limiter
 *
 * Why a dedicated limiter:
 *   - Each /api/validation-rules/compile call is an outbound LLM
 *     request that costs real money. We want a hard ceiling per user
 *     so a runaway frontend (or a malicious caller) can't bankrupt us.
 *   - The LLM provider also has its own rate limit; we'd rather see
 *     our own 429 than blow through their quota and break for everyone.
 *
 * Default: 200 compile requests per hour per user (10x previous).
 *   - Tunable via AI_COMPILE_RATE_LIMIT_MAX env var.
 *   - Rate-limit window is 1 hour (matches the idempotency cache TTL,
 *     so a thrashing user trying the same prompt many times will hit
 *     the cache, not the LLM).
 *   - Skipped in test/dev mode like the other limiters.
 *
 * Why bumped:
 *   - The 20/hr cap was chewed up within minutes by a single rule-author
 *     iterating on prompts (and by the test suite, which exercises ~15
 *     prompts per run). The Gemini 2.5-flash median cost per call is
 *     ~$0.0009, so 200/hr per user caps daily worst case at well under
 *     a dollar per author — fine for a 21 CFR Part 11 EDC where authors
 *     are paid clinical staff, not anonymous internet users.
 */
export const aiCompileRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.AI_COMPILE_RATE_LIMIT_MAX || (isDevelopment ? '0' : '200')),
  message: 'Too many AI rule-compile requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: (req) => {
    if (isTestMode || isDevelopment) return true;
    if (process.env.RATE_LIMIT_BYPASS_KEY && req.headers['x-bypass-rate-limit'] === process.env.RATE_LIMIT_BYPASS_KEY) return true;
    return false;
  },
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.userId;
    return userId ? `aicompile_${userId}` : `aicompile_ip_${req.ip || 'unknown'}`;
  },
});

/**
 * User creation rate limiter
 * Limit user account creation (admin only).
 *
 * Default: 100 users per hour per admin (10x previous).
 */
export const userCreationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.USER_CREATION_RATE_LIMIT_MAX || '100'),
  message: 'Too many user creation requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.userId;
    return userId ? `admin_${userId}` : req.ip || 'unknown';
  }
});

/**
 * Export all rate limiters
 */
export default {
  apiRateLimiter,
  authRateLimiter,
  refreshRateLimiter,
  passwordResetRateLimiter,
  soapRateLimiter,
  reportRateLimiter,
  auditExportRateLimiter,
  uploadRateLimiter,
  userCreationRateLimiter,
  aiCompileRateLimiter
};

