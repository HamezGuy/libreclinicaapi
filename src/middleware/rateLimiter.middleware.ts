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
 * General API rate limiter
 * Applies to all API endpoints
 * 
 * Default: 100 requests per 15 minutes per IP
 */
export const apiRateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes default
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: rateLimitHandler,
  skip: (req) => {
    // Skip rate limiting for health check or in test mode
    return isTestMode || req.path === '/health' || req.path === '/api/health';
  }
});

/**
 * Authentication rate limiter
 * Stricter limits for login endpoints to prevent brute force
 * 
 * Default: 5 login attempts per 15 minutes per IP
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5'), // Limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts. Please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestMode, // Skip rate limiting in test mode
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
 * Password reset rate limiter
 * Limit password reset attempts
 * 
 * Default: 3 attempts per hour per IP
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset attempts per hour
  message: 'Too many password reset attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
});

/**
 * SOAP operation rate limiter
 * Limit write operations to LibreClinica
 * More generous for data entry workflows
 * 
 * Default: 50 requests per 15 minutes per IP
 */
export const soapRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 SOAP operations per windowMs
  message: 'Too many data operations. Please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
});

/**
 * Report generation rate limiter
 * Limit resource-intensive report generation
 * 
 * Default: 10 reports per hour per user
 */
export const reportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 reports per hour
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
 * Limit audit trail exports (resource intensive)
 * 
 * Default: 5 exports per hour per user
 */
export const auditExportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each user to 5 audit exports per hour
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
 * Limit file upload operations
 * 
 * Default: 20 uploads per hour per user
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each user to 20 file uploads per hour
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
 * User creation rate limiter
 * Limit user account creation (admin only)
 * 
 * Default: 10 users per hour per admin
 */
export const userCreationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit to 10 user creations per hour
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
  passwordResetRateLimiter,
  soapRateLimiter,
  reportRateLimiter,
  auditExportRateLimiter,
  uploadRateLimiter,
  userCreationRateLimiter
};

