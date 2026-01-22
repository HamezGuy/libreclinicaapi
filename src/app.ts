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
// Validation rules
import validationRulesRoutes from './routes/validation-rules.routes';
// Electronic Signatures (21 CFR Part 11)
import esignatureRoutes from './routes/esignature.routes';
// 21 CFR Part 11 Compliance
import complianceRoutes from './routes/compliance.routes';
// Study Parameters (enrollment configuration)
import studyParametersRoutes from './routes/studyParameters.routes';
// Study Groups (randomization/treatment arms)
import studyGroupsRoutes from './routes/studyGroups.routes';
// Unified Tasks (aggregates queries, visits, forms, SDV, signatures)
import tasksRoutes from './routes/tasks.routes';
// Data Export (CSV, ODM XML) - Part 11 compliant via SOAP
import exportRoutes from './routes/export.routes';
// Data Import (CSV, ODM XML) - Part 11 compliant via SOAP
import importRoutes from './routes/import.routes';
// Adverse Event (AE/SAE) Tracking - Part 11 compliant via SOAP
import aeRoutes from './routes/ae.routes';
// File Uploads for CRF fields (response_type = 4)
import filesRoutes from './routes/files.routes';
// Backup and Recovery (21 CFR Part 11 compliant)
import backupRoutes from './routes/backup.routes';
// Retention Management (21 CFR Part 11 & HIPAA compliant)
import retentionRoutes from './routes/retention.routes';
// Regulatory Export (21 CFR Part 11 & HIPAA compliant)
import regulatoryExportRoutes from './routes/regulatory-export.routes';
// Print/PDF Generation (21 CFR Part 11 compliant)
import printRoutes from './routes/print.routes';
// Double Data Entry (21 CFR Part 11 compliant) - Uses NATIVE LibreClinica tables
import ddeRoutes from './routes/dde.routes';
// CRF/Item Flagging (uses LibreClinica native tables: event_crf_flag, item_data_flag)
import flaggingRoutes from './routes/flagging.routes';
// Organization management, invite codes, access requests
// import organizationRoutes from './routes/organization.routes';
// // Skip Logic and Form Linking
// import skipLogicRoutes from './routes/skip-logic.routes';
// // Site/Location Management
// import siteRoutes from './routes/site.routes';
// // Form Layout (column configuration)
// import formLayoutRoutes from './routes/form-layout.routes';

// ============================================================================
// FEATURE FLAGS FOR CUSTOM TABLE EXTENSIONS
// ============================================================================
// The following features use custom acc_* tables that extend LibreClinica.
// These tables have been migrated and are available in the database.
// Set environment variables to 'false' to disable specific features if needed.
// ============================================================================
const ENABLE_EMAIL_NOTIFICATIONS = process.env.ENABLE_EMAIL_NOTIFICATIONS !== 'false';
const ENABLE_SUBJECT_TRANSFERS = process.env.ENABLE_SUBJECT_TRANSFERS !== 'false';
const ENABLE_ECONSENT = process.env.ENABLE_ECONSENT !== 'false';
const ENABLE_EPRO = process.env.ENABLE_EPRO !== 'false';
const ENABLE_RTSM = process.env.ENABLE_RTSM !== 'false';

// Conditionally import routes only when enabled
let emailRoutes: any, transferRoutes: any, consentRoutes: any, eproRoutes: any, rtsmRoutes: any;

const app = express();

// Trust proxy - Required when behind nginx/load balancer for correct IP detection
// This ensures rate limiting and logging work correctly with X-Forwarded-For headers
app.set('trust proxy', 1);

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
// In production, nginx handles CORS to avoid duplicate headers
// Only enable CORS middleware in development
if (config.server.env !== 'production') {
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
        : ['http://localhost:4200', 'http://localhost:3000', 'http://localhost:3001'];
      
      // Check for exact match or wildcard patterns
      const isAllowed = allowedOrigins.some(allowed => {
        if (allowed.includes('*')) {
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
        callback(null, true);
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
  };
  app.use(cors(corsOptions));
  logger.info('CORS middleware enabled (development mode)');
} else {
  logger.info('CORS handled by nginx (production mode)');
}

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
// Validation rules management
app.use('/api/validation-rules', validationRulesRoutes);
// Electronic Signatures (21 CFR Part 11 compliant)
app.use('/api/esignature', esignatureRoutes);
// 21 CFR Part 11 Compliance Status and Audit Trail
app.use('/api/compliance', complianceRoutes);
// Study Parameters (enrollment configuration)
app.use('/api/study-parameters', studyParametersRoutes);
// Study Groups (randomization/treatment arms)
app.use('/api/study-groups', studyGroupsRoutes);
// Unified Tasks (aggregates real LibreClinica work items)
app.use('/api/tasks', tasksRoutes);
// Data Export (Part 11 compliant - uses LibreClinica SOAP)
app.use('/api/export', exportRoutes);
// Data Import (Part 11 compliant - uses LibreClinica SOAP)
app.use('/api/import', importRoutes);
// Adverse Events (Part 11 compliant - AEs are CRF forms)
app.use('/api/ae', aeRoutes);
// File Uploads (Part 11 compliant - for CRF file fields)
app.use('/api/files', filesRoutes);
// Backup and Recovery (Part 11 compliant - database backups)
app.use('/api/backup', backupRoutes);
// Retention Management (Part 11 & HIPAA compliant - policies, legal holds, cleanup)
app.use('/api/retention', retentionRoutes);
// Regulatory Export (Part 11 & HIPAA compliant - FDA/EMA submission packages)
app.use('/api/regulatory-export', regulatoryExportRoutes);
// Print/PDF Generation (Part 11 compliant - form printing, casebooks, audit trails)
app.use('/api/print', printRoutes);
// Double Data Entry (Part 11 compliant - uses NATIVE LibreClinica tables)
app.use('/api/dde', ddeRoutes);
// CRF/Item Flagging (Part 11 compliant - uses native LibreClinica tables)
app.use('/api/flagging', flaggingRoutes);
// Organization management, invite codes, access requests
// app.use('/api/organizations', organizationRoutes);
// // Skip Logic, Form Linking, and Branching
// app.use('/api/skip-logic', skipLogicRoutes);
// // Site/Location Management
// app.use('/api/sites', siteRoutes);
// app.use('/api/form-layout', formLayoutRoutes);

// ============================================================================
// CONDITIONAL ROUTES - Require custom acc_* tables
// ============================================================================
// These routes are DISABLED by default. To enable:
// 1. Run the corresponding migration script from /migrations/
// 2. Set the environment variable to 'true'
// ============================================================================

if (ENABLE_EMAIL_NOTIFICATIONS) {
  const emailRoutes = require('./routes/email.routes').default;
  app.use('/api/email', emailRoutes);
  logger.info('✅ Email Notifications enabled (acc_email_* tables required)');
} else {
  app.use('/api/email', (req: Request, res: Response) => {
    res.status(503).json({
      success: false,
      error: 'Email Notifications feature is disabled',
      message: 'This feature requires custom database tables. Set ENABLE_EMAIL_NOTIFICATIONS=true and run migrations/email_notifications.sql'
    });
  });
}

if (ENABLE_SUBJECT_TRANSFERS) {
  const transferRoutes = require('./routes/transfer.routes').default;
  app.use('/api/transfers', transferRoutes);
  logger.info('✅ Subject Transfers enabled (acc_transfer_log table required)');
} else {
  app.use('/api/transfers', (req: Request, res: Response) => {
    res.status(503).json({
      success: false,
      error: 'Subject Transfers feature is disabled',
      message: 'This feature requires custom database tables. Set ENABLE_SUBJECT_TRANSFERS=true and run migrations/subject_transfer.sql'
    });
  });
}

if (ENABLE_ECONSENT) {
  const consentRoutes = require('./routes/consent.routes').default;
  app.use('/api/consent', consentRoutes);
  logger.info('✅ eConsent enabled (acc_consent_* tables required)');
} else {
  app.use('/api/consent', (req: Request, res: Response) => {
    res.status(503).json({
      success: false,
      error: 'eConsent feature is disabled',
      message: 'This feature requires custom database tables. Set ENABLE_ECONSENT=true and run migrations/econsent.sql'
    });
  });
}

if (ENABLE_EPRO) {
  const eproRoutes = require('./routes/epro.routes').default;
  app.use('/api/epro', eproRoutes);
  logger.info('✅ ePRO/Patient Portal enabled (acc_pro_* tables required)');
} else {
  app.use('/api/epro', (req: Request, res: Response) => {
    res.status(503).json({
      success: false,
      error: 'ePRO/Patient Portal feature is disabled',
      message: 'This feature requires custom database tables. Set ENABLE_EPRO=true and run migrations/epro_patient_portal.sql'
    });
  });
}

if (ENABLE_RTSM) {
  const rtsmRoutes = require('./routes/rtsm.routes').default;
  app.use('/api/rtsm', rtsmRoutes);
  logger.info('✅ RTSM/IRT enabled (acc_kit_* tables required)');
} else {
  app.use('/api/rtsm', (req: Request, res: Response) => {
    res.status(503).json({
      success: false,
      error: 'RTSM/IRT feature is disabled',
      message: 'This feature requires custom database tables. Set ENABLE_RTSM=true and run migrations/rtsm_irt.sql'
    });
  });
}

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
      esignature: '/api/esignature - 21 CFR Part 11 compliant electronic signatures',
      soap: '/api/soap - SOAP status, diagnostics, and configuration',
      libreclinica: '/api/libreclinica - Proxy to LibreClinica native REST APIs',
      export: '/api/export - Data export (CSV, ODM XML) via LibreClinica SOAP',
      import: '/api/import - Data import (CSV, ODM XML) via LibreClinica SOAP',
      ae: '/api/ae - Adverse Event tracking (SAE/AE) via LibreClinica SOAP',
      backup: '/api/backup - Database backup and recovery (21 CFR Part 11 compliant)',
      print: '/api/print - PDF generation for forms, casebooks, and audit trails',
      dde: '/api/dde - Double data entry workflow (uses native LibreClinica tables)',
      flagging: '/api/flagging - CRF/Item flagging for data review (uses native LibreClinica tables)',
      organizations: '/api/organizations - Organization management, invite codes, access requests',
      skipLogic: '/api/skip-logic - Skip logic rules, form linking, and conditional visibility',
      sites: '/api/sites - Site/location management and patient-site assignments',
      // Conditional features - require custom tables
      email: ENABLE_EMAIL_NOTIFICATIONS ? '/api/email - Email notifications (ENABLED)' : '/api/email - DISABLED (requires acc_email_* tables)',
      transfers: ENABLE_SUBJECT_TRANSFERS ? '/api/transfers - Subject transfers (ENABLED)' : '/api/transfers - DISABLED (requires acc_transfer_log table)',
      consent: ENABLE_ECONSENT ? '/api/consent - eConsent (ENABLED)' : '/api/consent - DISABLED (requires acc_consent_* tables)',
      epro: ENABLE_EPRO ? '/api/epro - ePRO/Patient Portal (ENABLED)' : '/api/epro - DISABLED (requires acc_pro_* tables)',
      rtsm: ENABLE_RTSM ? '/api/rtsm - RTSM/IRT (ENABLED)' : '/api/rtsm - DISABLED (requires acc_kit_* tables)'
    },
    featureFlags: {
      email_notifications: ENABLE_EMAIL_NOTIFICATIONS,
      subject_transfers: ENABLE_SUBJECT_TRANSFERS,
      econsent: ENABLE_ECONSENT,
      epro: ENABLE_EPRO,
      rtsm: ENABLE_RTSM
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

