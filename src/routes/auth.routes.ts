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

// Capture token generation (requires auth)
router.post('/capture-token', authMiddleware, controller.generateCaptureToken);

export default router;

