/**
 * SOAP Health & Diagnostics Routes
 * 
 * Provides endpoints to:
 * - Check SOAP connection status
 * - Test individual SOAP services
 * - Get SOAP configuration details
 * - Run SOAP diagnostics
 */

import { Router, Request, Response } from 'express';
import { getSoapClient } from '../services/soap/soapClient';
import { config } from '../config/environment';
import { logger } from '../config/logger';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = Router();

/**
 * SOAP service endpoints to check
 * LibreClinica SOAP endpoints use /ws/{serviceName}/v1 format
 */
const SOAP_SERVICES = [
  { name: 'studySubject', endpoint: '/studySubject/v1', description: 'Subject enrollment' },
  { name: 'study', endpoint: '/study/v1', description: 'Study metadata' },
  { name: 'data', endpoint: '/data/v1', description: 'CRF data import/export' },
  { name: 'event', endpoint: '/event/v1', description: 'Study events' },
  { name: 'crf', endpoint: '/crf/v1', description: 'CRF definitions' }
];

/**
 * GET /api/soap/status
 * Get overall SOAP connection status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const soapEnabled = config.libreclinica.soapEnabled;
    const soapUrl = config.libreclinica.soapUrl;

    if (!soapEnabled) {
      return res.json({
        success: true,
        data: {
          enabled: false,
          message: 'SOAP is disabled. System is using direct database access.',
          url: soapUrl,
          status: 'disabled',
          fallbackMode: 'database'
        }
      });
    }

    // Test SOAP connection
    const soapClient = getSoapClient();
    const isConnected = await soapClient.testConnection('studySubject');

    res.json({
      success: true,
      data: {
        enabled: true,
        connected: isConnected,
        url: soapUrl,
        status: isConnected ? 'connected' : 'disconnected',
        fallbackMode: isConnected ? 'none' : 'database',
        message: isConnected 
          ? 'SOAP connection is active' 
          : 'SOAP connection failed - system is using database fallback'
      }
    });
  } catch (error: any) {
    logger.error('SOAP status check error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to check SOAP status',
      error: error.message
    });
  }
});

/**
 * GET /api/soap/services
 * Check status of individual SOAP services
 */
router.get('/services', authMiddleware, async (req: Request, res: Response) => {
  try {
    const soapEnabled = config.libreclinica.soapEnabled;
    const soapUrl = config.libreclinica.soapUrl;

    if (!soapEnabled) {
      return res.json({
        success: true,
        data: {
          enabled: false,
          services: SOAP_SERVICES.map(s => ({
            ...s,
            status: 'disabled',
            available: false
          }))
        }
      });
    }

    const soapClient = getSoapClient();
    const serviceStatuses = await Promise.all(
      SOAP_SERVICES.map(async (service) => {
        try {
          const isAvailable = await soapClient.testConnection(service.name as any);
          return {
            ...service,
            wsdlUrl: `${soapUrl}${service.endpoint}?wsdl`,
            status: isAvailable ? 'available' : 'unavailable',
            available: isAvailable
          };
        } catch (error: any) {
          return {
            ...service,
            wsdlUrl: `${soapUrl}${service.endpoint}?wsdl`,
            status: 'error',
            available: false,
            error: error.message
          };
        }
      })
    );

    res.json({
      success: true,
      data: {
        enabled: true,
        baseUrl: soapUrl,
        services: serviceStatuses
      }
    });
  } catch (error: any) {
    logger.error('SOAP services check error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to check SOAP services',
      error: error.message
    });
  }
});

/**
 * GET /api/soap/config
 * Get SOAP configuration (admin only)
 */
router.get('/config', authMiddleware, requireRole('admin'), (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      enabled: config.libreclinica.soapEnabled,
      url: config.libreclinica.soapUrl,
      username: config.libreclinica.soapUsername,
      // Never expose password
      passwordSet: !!config.libreclinica.soapPassword,
      endpoints: SOAP_SERVICES.map(s => ({
        name: s.name,
        description: s.description,
        wsdl: `${config.libreclinica.soapUrl}${s.endpoint}?wsdl`
      })),
      timeout: 30000,
      maxRetries: 3
    }
  });
});

/**
 * POST /api/soap/test
 * Run SOAP connectivity test
 */
router.post('/test', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  const { service = 'studySubject' } = req.body;

  try {
    if (!config.libreclinica.soapEnabled) {
      return res.json({
        success: false,
        data: {
          tested: false,
          message: 'SOAP is disabled in configuration',
          hint: 'Set DISABLE_SOAP=false to enable SOAP'
        }
      });
    }

    logger.info('Running SOAP connectivity test', { service });

    const soapClient = getSoapClient();
    
    // Clear cached clients to force fresh connection
    soapClient.clearClients();

    const startTime = Date.now();
    const isConnected = await soapClient.testConnection(service);
    const duration = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        tested: true,
        service,
        connected: isConnected,
        responseTime: duration,
        url: config.libreclinica.soapUrl,
        timestamp: new Date().toISOString(),
        details: isConnected
          ? `Successfully connected to ${service} service in ${duration}ms`
          : `Failed to connect to ${service} service after ${duration}ms`
      }
    });
  } catch (error: any) {
    logger.error('SOAP test failed', { error: error.message, service });
    res.status(500).json({
      success: false,
      message: 'SOAP test failed',
      error: error.message
    });
  }
});

/**
 * GET /api/soap/diagnostics
 * Run full SOAP diagnostics (admin only)
 */
router.get('/diagnostics', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    configuration: {
      enabled: config.libreclinica.soapEnabled,
      url: config.libreclinica.soapUrl,
      username: config.libreclinica.soapUsername
    },
    connectivity: {},
    services: [],
    recommendations: []
  };

  try {
    // Check if SOAP is enabled
    if (!config.libreclinica.soapEnabled) {
      diagnostics.connectivity.status = 'disabled';
      diagnostics.recommendations.push({
        level: 'info',
        message: 'SOAP is disabled. Set DISABLE_SOAP=false to enable.',
        impact: 'System uses direct database access instead of SOAP'
      });
      return res.json({ success: true, data: diagnostics });
    }

    // Test base URL reachability
    const soapClient = getSoapClient();
    
    // Test each service
    for (const service of SOAP_SERVICES) {
      const startTime = Date.now();
      try {
        const isAvailable = await soapClient.testConnection(service.name as any);
        diagnostics.services.push({
          name: service.name,
          description: service.description,
          status: isAvailable ? 'available' : 'unavailable',
          responseTime: Date.now() - startTime
        });
      } catch (error: any) {
        diagnostics.services.push({
          name: service.name,
          description: service.description,
          status: 'error',
          error: error.message,
          responseTime: Date.now() - startTime
        });
      }
    }

    // Determine overall status
    const availableServices = diagnostics.services.filter((s: any) => s.status === 'available');
    const errorServices = diagnostics.services.filter((s: any) => s.status === 'error');

    if (availableServices.length === diagnostics.services.length) {
      diagnostics.connectivity.status = 'healthy';
      diagnostics.connectivity.message = 'All SOAP services are available';
    } else if (availableServices.length > 0) {
      diagnostics.connectivity.status = 'degraded';
      diagnostics.connectivity.message = `${availableServices.length}/${diagnostics.services.length} services available`;
    } else {
      diagnostics.connectivity.status = 'unavailable';
      diagnostics.connectivity.message = 'No SOAP services are available';
    }

    // Add recommendations
    if (errorServices.length > 0) {
      diagnostics.recommendations.push({
        level: 'warning',
        message: `${errorServices.length} SOAP service(s) returned errors`,
        services: errorServices.map((s: any) => s.name),
        action: 'Check LibreClinica is running and WSDL endpoints are accessible'
      });
    }

    if (diagnostics.connectivity.status === 'unavailable') {
      diagnostics.recommendations.push({
        level: 'critical',
        message: 'SOAP services are unavailable',
        action: 'Verify LibreClinica is running at ' + config.libreclinica.soapUrl,
        fallback: 'System will use direct database access'
      });

      diagnostics.recommendations.push({
        level: 'info',
        message: 'Common causes: LibreClinica not started, firewall blocking port 8080, incorrect SOAP URL'
      });
    }

    res.json({ success: true, data: diagnostics });
  } catch (error: any) {
    logger.error('SOAP diagnostics failed', { error: error.message });
    diagnostics.connectivity.status = 'error';
    diagnostics.connectivity.error = error.message;
    diagnostics.recommendations.push({
      level: 'critical',
      message: 'Failed to run SOAP diagnostics',
      error: error.message
    });
    res.json({ success: true, data: diagnostics });
  }
});

/**
 * POST /api/soap/reconnect
 * Force reconnection to SOAP services (clears cache)
 */
router.post('/reconnect', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const soapClient = getSoapClient();
    soapClient.clearClients();
    
    logger.info('SOAP clients cache cleared, attempting reconnection');

    // Test connection after clearing cache
    const isConnected = await soapClient.testConnection('studySubject');

    res.json({
      success: true,
      data: {
        reconnected: isConnected,
        message: isConnected 
          ? 'Successfully reconnected to SOAP services'
          : 'Reconnection attempted but SOAP services are unavailable',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    logger.error('SOAP reconnection failed', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to reconnect to SOAP services',
      error: error.message
    });
  }
});

export default router;

