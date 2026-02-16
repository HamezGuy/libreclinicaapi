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

const PORT = config.server.port || 3000;
const HOST = '0.0.0.0';

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
 * Start the server
 */
async function startServer() {
  try {
    logger.info('Starting LibreClinica API server...');

    // Test database connection
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      logger.error('Cannot start server: Database connection failed');
      process.exit(1);
    }

    // Verify audit tables exist (21 CFR Part 11 compliance)
    await verifyAuditTables();

    // Run startup migrations for acc_* extension tables
    await runStartupMigrations(pool);

    // Test SOAP connection (warning only)
    await testSoapConnection();

    // Initialize backup scheduler (21 CFR Part 11 compliant automated backups)
    await initializeBackupScheduler();

    // Start Express server
    const server = app.listen(PORT, HOST, () => {
      logger.info(` LibreClinica API started successfully`, {
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
    });

    // Graceful shutdown handlers
    const gracefulShutdown = (signal: string) => {
      logger.info(`${signal} received, starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
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

    // Handle uncaught errors
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: any) => {
      logger.error('Unhandled rejection', {
        reason: reason?.message || reason
      });
      process.exit(1);
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


