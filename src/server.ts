/**
 * Server Startup
 * 
 * Main server entry point
 * - Database connection test
 * - SOAP connection test
 * - Server startup
 * - Graceful shutdown
 */

import app from './app';
import { config } from './config/environment';
import { pool } from './config/database';
import { logger } from './config/logger';
import { getSoapClient } from './services/soap/soapClient';
import { initializeScheduler } from './services/backup/backup-scheduler.service';
import { runStartupMigrations } from './config/migrations';
import { startEmailWorker, stopEmailWorker } from './services/email/email-worker';

const PORT = config.server.port || 3000;
const HOST = '0.0.0.0';

/**
 * Validate that critical secrets are set before allowing production startup.
 * Prevents running with default/guessable values that violate 21 CFR Part 11.
 */
function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const errors: string[] = [];

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret || jwtSecret.includes('change-me')) {
    errors.push('JWT_SECRET must be set to a strong random value in production');
  }

  const encKey = process.env.ENCRYPTION_MASTER_KEY || '';
  if (!encKey || encKey.includes('change-me')) {
    errors.push('ENCRYPTION_MASTER_KEY must be set to a strong random value in production');
  }

  const encSalt = process.env.ENCRYPTION_SALT || '';
  if (!encSalt || encSalt.includes('change-me') || encSalt.includes('default')) {
    errors.push('ENCRYPTION_SALT must be set to a unique value in production');
  }

  if (process.env.DEMO_MODE === 'true') {
    errors.push('DEMO_MODE must be false in production (21 CFR Part 11 §11.10(d))');
  }

  if (process.env.DB_SSL !== 'true') {
    errors.push('DB_SSL must be true in production (21 CFR Part 11 §11.10(a) — data in transit)');
  }

  if (errors.length > 0) {
    logger.error('PRODUCTION CONFIGURATION ERRORS — refusing to start:', { errors });
    console.error('\n=== PRODUCTION STARTUP BLOCKED ===');
    errors.forEach(e => console.error(`  ✗ ${e}`));
    console.error('==================================\n');
    process.exit(1);
  }

  logger.info('Production configuration validated successfully');
}

/**
 * Test database connection
 */
async function testDatabaseConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as db_version');
    logger.info('Database connection successful', {
      time: result.rows[0].current_time,
      version: result.rows[0].db_version
    });
    return true;
  } catch (error: any) {
    logger.error('Database connection failed', {
      error: error.message,
      host: config.libreclinica.database.host,
      database: config.libreclinica.database.database
    });
    return false;
  }
}

/**
 * Verify and initialize audit tables
 * Ensures audit_user_login table exists for 21 CFR Part 11 compliance
 */
async function verifyAuditTables(): Promise<void> {
  try {
    // Check if audit_user_login table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'audit_user_login'
      ) as exists
    `);
    
    if (!tableCheck.rows[0].exists) {
      // audit_user_login is a LibreClinica Core table created by Liquibase.
      // Do NOT create it here - it would conflict with Liquibase migrations.
      // If missing, LibreClinica Core hasn't finished initializing yet.
      logger.warn('audit_user_login table not found - LibreClinica Core may still be initializing. Login audit will be unavailable until the table exists.');
    } else {
      // Verify the table has data
      const countResult = await pool.query('SELECT COUNT(*) as count FROM audit_user_login');
      logger.info('audit_user_login table verified', {
        recordCount: parseInt(countResult.rows[0].count)
      });
    }
    
    // Also verify audit_user_api_log table
    const apiLogCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'audit_user_api_log'
      ) as exists
    `);
    
    if (!apiLogCheck.rows[0].exists) {
      logger.warn('audit_user_api_log table does not exist — will be created by startup migrations');
    }
    
  } catch (error: any) {
    logger.error('Failed to verify audit tables', {
      error: error.message
    });
    // Don't fail startup, but log the error
  }
}

/**
 * Test SOAP connection
 */
async function testSoapConnection(): Promise<boolean> {
  // Skip SOAP if disabled in config
  if (!config.libreclinica.soapEnabled) {
    logger.info('SOAP disabled - using direct database access only');
    return false;
  }

  try {
    const soapClient = getSoapClient();
    const isConnected = await soapClient.testConnection('study');
    
    if (isConnected) {
      logger.info('SOAP connection successful', {
        url: config.libreclinica.soapUrl
      });
      return true;
    } else {
      logger.warn('SOAP connection test failed', {
        url: config.libreclinica.soapUrl
      });
      return false;
    }
  } catch (error: any) {
    logger.warn('SOAP connection test error', {
      error: error.message,
      url: config.libreclinica.soapUrl
    });
    // Don't fail startup on SOAP error - it might not be available yet
    return false;
  }
}

/**
 * Initialize backup scheduler
 */
async function initializeBackupScheduler(): Promise<void> {
  try {
    await initializeScheduler();
  } catch (error: any) {
    logger.error('Failed to initialize backup scheduler', {
      error: error.message
    });
    // Don't fail startup, but log the error
  }
}

/**
 * Repair all auto-increment sequences so nextval() never collides with existing PKs.
 * This is a one-shot fix at startup that covers every table the API inserts into.
 */
async function repairAllSequences(): Promise<void> {
  const pairs: [string, string, string][] = [
    ['crf_crf_id_seq', 'crf', 'crf_id'],
    ['crf_version_crf_version_id_seq', 'crf_version', 'crf_version_id'],
    ['item_item_id_seq', 'item', 'item_id'],
    ['item_group_item_group_id_seq', 'item_group', 'item_group_id'],
    ['event_crf_event_crf_id_seq', 'event_crf', 'event_crf_id'],
    ['study_event_definition_study_event_definition_id_seq', 'study_event_definition', 'study_event_definition_id'],
    ['study_event_study_event_id_seq', 'study_event', 'study_event_id'],
    ['event_definition_crf_event_definition_crf_id_seq', 'event_definition_crf', 'event_definition_crf_id'],
    ['discrepancy_note_discrepancy_note_id_seq', 'discrepancy_note', 'discrepancy_note_id'],
    ['item_data_item_data_id_seq', 'item_data', 'item_data_id'],
    ['subject_subject_id_seq', 'subject', 'subject_id'],
    ['study_subject_study_subject_id_seq', 'study_subject', 'study_subject_id'],
    // ISSUE-414 fix: audit_log_event_type has gaps (rows 34, 36-39 missing),
    // so nextval() collided with existing PKs every boot when the seeder
    // tried to add new event-type rows. Repairing this sequence pushes
    // nextval() past MAX(audit_log_event_type_id), so seeding inserts cleanly.
    ['audit_log_event_type_audit_log_event_type_id_seq', 'audit_log_event_type', 'audit_log_event_type_id'],
  ];

  let repaired = 0;
  for (const [seq, table, pk] of pairs) {
    try {
      const result = await pool.query(`
        SELECT setval($1::regclass,
          GREATEST(
            (SELECT COALESCE(MAX(${pk}), 0) FROM ${table}),
            (SELECT last_value FROM ${seq})
          )
        )
      `, [seq]);
      repaired++;
    } catch {
      // Table or sequence may not exist yet — skip silently
    }
  }
  logger.info(`Sequence repair complete: ${repaired} sequences verified`);
}

/**
 * Run all database initialization tasks (migrations, seeds, sequence repair).
 * Runs AFTER Express is already listening so that /health passes immediately.
 */
async function initializeDatabase(): Promise<void> {
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    logger.error('Database connection failed — API requests requiring DB will error until resolved');
    return;
  }

  await verifyAuditTables();
  await runStartupMigrations(pool);
  await repairAllSequences();
  await testSoapConnection();

  try {
    const { ensureAuditEventTypesSeeded } = await import('./services/database/audit.service');
    await ensureAuditEventTypesSeeded();
  } catch (e: any) {
    logger.warn('Audit event-type seed failed (non-fatal)', { error: e.message });
  }

  await initializeBackupScheduler();

  if (process.env.EMAIL_QUEUE_ENABLED !== 'false') {
    startEmailWorker();
  }

  logger.info('Database initialization completed successfully');
}

/**
 * Start the server
 *
 * Strategy: bind the HTTP port FIRST so Docker health checks pass immediately,
 * then run the (potentially slow) database initialization in the background.
 * This prevents the health-check → restart → health-check death loop that
 * occurs when DB pool acquisition takes longer than start_period.
 */
async function startServer() {
  try {
    validateProductionConfig();

    logger.info('Starting LibreClinica API server...');

    // Start Express server IMMEDIATELY so /health responds to Docker health checks.
    const http = await import('http');
    const server = http.createServer({ maxHeaderSize: 64 * 1024 }, app);
    server.headersTimeout = 120000;
    server.requestTimeout = 300000;
    server.listen(PORT, HOST, () => {
      logger.info('LibreClinica API listening — starting DB initialization', {
        port: PORT,
        host: HOST,
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version
      });

      logger.info('API endpoints:', {
        health: `http://${HOST}:${PORT}/health`,
        api: `http://${HOST}:${PORT}/api`,
        auth: `http://${HOST}:${PORT}/api/auth/login`
      });

      logger.info('Security features enabled:', {
        helmet: 'enabled',
        cors: 'enabled',
        rateLimiting: 'enabled',
        auditLogging: 'enabled',
        jwtAuth: 'enabled'
      });

      // Database initialization runs AFTER the port is open.
      // This is intentional: /health will respond immediately; API routes
      // that need the DB will get pool-level errors until init completes,
      // but Docker will not kill the container for being unhealthy.
      initializeDatabase().catch((err) => {
        logger.error('Database initialization failed (server stays up for health checks)', {
          error: err.message,
          stack: err.stack
        });
      });
    });

    // Graceful shutdown handlers
    const gracefulShutdown = (signal: string) => {
      logger.info(`${signal} received, starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          stopEmailWorker();
          await pool.end();
          logger.info('Database connections closed');

          logger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error: any) {
          logger.error('Error during shutdown', { error: error.message });
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught errors — log but do NOT crash.
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception (non-fatal, server continues)', {
        error: error.message,
        stack: error.stack
      });
    });

    process.on('unhandledRejection', (reason: any) => {
      logger.error('Unhandled rejection (non-fatal, server continues)', {
        reason: reason?.message || reason,
        stack: reason?.stack
      });
    });

  } catch (error: any) {
    logger.error('Server startup failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Start the server
startServer();

