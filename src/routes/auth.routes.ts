/**
 * Authentication Routes
 * 
 * Includes WoundScanner capture token endpoints
 */

import express from 'express';
import * as controller from '../controllers/auth.controller';
import { validate, authSchemas } from '../middleware/validation.middleware';
import { authRateLimiter, refreshRateLimiter } from '../middleware/rateLimiter.middleware';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// Admin: reset rate limiter (requires bypass key)
router.post('/reset-rate-limit', (req, res) => {
  const key = req.headers['x-bypass-rate-limit'] || req.body?.bypassKey;
  const expected = process.env.RATE_LIMIT_BYPASS_KEY || 'accura-test-bypass-2026';
  if (key !== expected) {
    res.status(403).json({ success: false, message: 'Invalid bypass key' });
    return;
  }
  authRateLimiter.resetKey(req.ip || '');
  res.json({ success: true, message: 'Rate limit reset for your IP' });
});

// Public routes with appropriate rate limiting
// Login and Google auth use strict rate limiting (10 per 15 min)
router.post('/login', authRateLimiter, validate({ body: authSchemas.login }), controller.login);
router.post('/google', authRateLimiter, validate({ body: authSchemas.googleAuth }), controller.googleLogin);
// Refresh uses more generous rate limiting (60 per 15 min)
router.post('/refresh', refreshRateLimiter, validate({ body: authSchemas.refreshToken }), controller.refresh);

// Token validation for iOS app (no auth - token in body)
router.post('/validate-token', controller.validateCaptureToken);

// Protected routes (auth required)
router.get('/verify', authMiddleware, controller.verify);
router.post('/logout', authMiddleware, controller.logout);

// Profile management (self-service)
router.get('/profile', authMiddleware, controller.getProfile);
router.put('/profile', authMiddleware, controller.updateProfile);

// Capture token generation (requires auth)
router.post('/capture-token', authMiddleware, controller.generateCaptureToken);

export default router;

