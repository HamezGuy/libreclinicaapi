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

    // Test SOAP connection (warning only)
    await testSoapConnection();

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


