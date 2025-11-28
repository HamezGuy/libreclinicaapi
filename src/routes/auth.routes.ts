/**
 * Authentication Routes
 * 
 * Includes WoundScanner capture token endpoints
 */

import express from 'express';
import * as controller from '../controllers/auth.controller';
import { validate, authSchemas } from '../middleware/validation.middleware';
import { authRateLimiter } from '../middleware/rateLimiter.middleware';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// Apply rate limiting to auth routes
router.use(authRateLimiter);

// Public routes (no auth required)
router.post('/login', validate({ body: authSchemas.login }), controller.login);
router.post('/google', validate({ body: authSchemas.googleAuth }), controller.googleLogin);
router.post('/refresh', validate({ body: authSchemas.refreshToken }), controller.refresh);

// Token validation for iOS app (no auth - token in body)
router.post('/validate-token', controller.validateCaptureToken);

// Protected routes (auth required)
router.get('/verify', authMiddleware, controller.verify);
router.post('/logout', authMiddleware, controller.logout);

// Capture token generation (requires auth)
router.post('/capture-token', authMiddleware, controller.generateCaptureToken);

export default router;

