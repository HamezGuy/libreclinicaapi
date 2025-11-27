/**
 * Express Application Setup
 * 
 * Main application configuration with all middleware and routes
 * - Security (Helmet, CORS)
 * - Body parsing
 * - Audit logging
 * - Rate limiting
 * - Routes
 * - Error handling
 */

import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/environment';
import { logger } from './config/logger';
import { auditMiddleware } from './middleware/audit.middleware';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.middleware';
import { apiRateLimiter } from './middleware/rateLimiter.middleware';

// Import routes
import authRoutes from './routes/auth.routes';
import subjectRoutes from './routes/subject.routes';
import studyRoutes from './routes/study.routes';
import formRoutes from './routes/form.routes';
import queryRoutes from './routes/query.routes';
import auditRoutes from './routes/audit.routes';
import dashboardRoutes from './routes/dashboard.routes';
import userRoutes from './routes/user.routes';
import workflowRoutes from './routes/workflow.routes';
import eventRoutes from './routes/event.routes';
// New routes merged from ElectronicDataCaptureReal/backend
import aiRoutes from './routes/ai.routes';
import sdvRoutes from './routes/sdv.routes';
import randomizationRoutes from './routes/randomization.routes';
import monitoringRoutes from './routes/monitoring.routes';
import codingRoutes from './routes/coding.routes';
import dataLocksRoutes from './routes/data-locks.routes';

const app = express();

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

// Helmet - Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS - Cross-Origin Resource Sharing
const corsOptions = {
  origin: config.security.allowedOrigins.length > 0 ? config.security.allowedOrigins : ['http://localhost:4200', 'https://www.accuratrials.com'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// ============================================================================
// BODY PARSING
// ============================================================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================================
// AUDIT LOGGING
// ============================================================================

app.use(auditMiddleware);

// ============================================================================
// GENERAL RATE LIMITING
// ============================================================================

app.use('/api', apiRateLimiter);

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      soap: 'available'
    }
  });
});

// ============================================================================
// API ROUTES
// ============================================================================

app.use('/api/auth', authRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/studies', studyRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/events', eventRoutes);
// New routes merged from ElectronicDataCaptureReal/backend
app.use('/api/ai', aiRoutes);
app.use('/api/sdv', sdvRoutes);
app.use('/api/randomization', randomizationRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/coding', codingRoutes);
app.use('/api/data-locks', dataLocksRoutes);

// ============================================================================
// ROOT ENDPOINT
// ============================================================================

app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'LibreClinica REST API',
    version: '1.0.0',
    description: '21 CFR Part 11 Compliant REST API for LibreClinica',
    documentation: '/api/docs',
    health: '/health',
    endpoints: {
      auth: '/api/auth',
      subjects: '/api/subjects',
      studies: '/api/studies',
      forms: '/api/forms',
      queries: '/api/queries',
      audit: '/api/audit',
      dashboard: '/api/dashboard',
      users: '/api/users',
      workflows: '/api/workflows',
      events: '/api/events',
      ai: '/api/ai',
      sdv: '/api/sdv',
      randomization: '/api/randomization',
      monitoring: '/api/monitoring',
      coding: '/api/coding',
      dataLocks: '/api/data-locks'
    }
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// ============================================================================
// EXPORT
// ============================================================================

export default app;

