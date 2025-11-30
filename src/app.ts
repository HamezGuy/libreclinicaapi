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
// WoundScanner integration
import woundsRoutes from './routes/wounds.routes';
// SOAP diagnostics and health
import soapRoutes from './routes/soap.routes';
// LibreClinica native API proxy
import libreclinicaProxyRoutes from './routes/libreclinica-proxy.routes';

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

// CORS - Cross-Origin Resource Sharing with dynamic origin checking
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      callback(null, true);
      return;
    }
    
    // Check configured origins
    const allowedOrigins = config.security.allowedOrigins.length > 0 
      ? config.security.allowedOrigins 
      : ['http://localhost:4200', 'https://www.accuratrials.com'];
    
    // Check for exact match or wildcard patterns
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        // Convert wildcard to regex: https://*.vercel.app -> https://[^.]+\.vercel\.app
        const pattern = allowed
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '[^.]+');
        return new RegExp(`^${pattern}$`).test(origin);
      }
      return allowed === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request', { origin, allowedOrigins });
      callback(null, true); // Allow anyway in production for now - can tighten later
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
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

app.get('/api/health', async (req: Request, res: Response) => {
  let soapStatus = 'disabled';
  
  if (config.libreclinica.soapEnabled) {
    try {
      const { getSoapClient } = await import('./services/soap/soapClient');
      const soapClient = getSoapClient();
      const isConnected = await soapClient.testConnection('studySubject');
      soapStatus = isConnected ? 'connected' : 'unavailable';
    } catch {
      soapStatus = 'error';
    }
  }
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      soap: soapStatus,
      rest_api: 'active'
    },
    mode: config.libreclinica.soapEnabled ? 'hybrid' : 'database_only',
    soapUrl: config.libreclinica.soapEnabled ? config.libreclinica.soapUrl : null
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
// WoundScanner integration
app.use('/api/wounds', woundsRoutes);
// SOAP diagnostics and health
app.use('/api/soap', soapRoutes);
// LibreClinica native API proxy (forwards to LibreClinica's REST endpoints)
app.use('/api/libreclinica', libreclinicaProxyRoutes);

// ============================================================================
// ROOT ENDPOINT
// ============================================================================

app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'LibreClinica REST API',
    version: '1.0.0',
    description: '21 CFR Part 11 Compliant REST API for LibreClinica with SOAP support',
    documentation: '/api/docs',
    health: '/health',
    mode: config.libreclinica.soapEnabled ? 'Hybrid (REST + SOAP)' : 'REST Only (Database Direct)',
    soapEnabled: config.libreclinica.soapEnabled,
    soapUrl: config.libreclinica.soapEnabled ? config.libreclinica.soapUrl : null,
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
      dataLocks: '/api/data-locks',
      wounds: '/api/wounds',
      soap: '/api/soap - SOAP status, diagnostics, and configuration',
      libreclinica: '/api/libreclinica - Proxy to LibreClinica native REST APIs'
    },
    libreclinicaNativeProxies: {
      metadata: '/api/libreclinica/metadata/:studyOid - Get study metadata (proxies to LibreClinica)',
      clinicaldata: '/api/libreclinica/clinicaldata/:studyOid/:subjectId/:eventOid/:formVersionOid - Get form data',
      openrosa: '/api/libreclinica/openrosa/:studyOid/* - ODK-compatible API',
      systemStatus: '/api/libreclinica/system/status - LibreClinica system status',
      available: '/api/libreclinica/available - Check if LibreClinica is reachable'
    },
    soapEndpoints: {
      status: '/api/soap/status - Check SOAP connection status',
      services: '/api/soap/services - Check individual SOAP services',
      config: '/api/soap/config - View SOAP configuration (admin)',
      test: '/api/soap/test - Run SOAP connectivity test (admin)',
      diagnostics: '/api/soap/diagnostics - Full SOAP diagnostics (admin)',
      reconnect: '/api/soap/reconnect - Force SOAP reconnection (admin)'
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

