/**
 * LibreClinica Proxy Routes
 * 
 * These routes proxy to LibreClinica's NATIVE REST APIs instead of duplicating functionality.
 * LibreClinica Core (port 8080) provides its own REST endpoints that we should use.
 * 
 * Native LibreClinica REST endpoints:
 * - /rest/metadata/* - Study metadata in XML/JSON/HTML/PDF
 * - /rest/clinicaldata/* - Clinical data extraction
 * - /rest/openrosa/* - ODK-compatible form API
 * - /auth/api/v1/system/* - System status
 */

import { Router, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { config } from '../config/environment';
import { logger } from '../config/logger';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// LibreClinica base URL (without /ws)
const LIBRECLINICA_BASE = config.libreclinica.soapUrl.replace('/ws', '');

/**
 * Proxy helper - forwards request to LibreClinica
 */
async function proxyToLibreClinica(
  targetPath: string,
  req: Request,
  res: Response,
  options: { method?: string; body?: any } = {}
): Promise<void> {
  const url = new URL(targetPath, LIBRECLINICA_BASE);
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;

  const requestOptions = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: options.method || 'GET',
    headers: {
      'Accept': req.get('Accept') || 'application/json',
      'Content-Type': req.get('Content-Type') || 'application/json',
      // Forward auth if present
      ...(req.get('Authorization') ? { 'Authorization': req.get('Authorization') } : {})
    },
    timeout: 30000
  };

  logger.info('Proxying to LibreClinica', { 
    url: url.toString(),
    method: requestOptions.method 
  });

  return new Promise((resolve, reject) => {
    const proxyReq = client.request(requestOptions, (proxyRes) => {
      // Forward status and headers
      res.status(proxyRes.statusCode || 200);
      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        if (value) res.setHeader(key, value);
      });

      // Stream response
      proxyRes.pipe(res);
      proxyRes.on('end', () => resolve());
    });

    proxyReq.on('error', (error) => {
      logger.error('Proxy error', { error: error.message, url: url.toString() });
      res.status(502).json({
        success: false,
        message: 'Failed to connect to LibreClinica',
        error: error.message
      });
      resolve();
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({
        success: false,
        message: 'LibreClinica request timed out'
      });
      resolve();
    });

    // Send body if present
    if (options.body) {
      proxyReq.write(JSON.stringify(options.body));
    }

    proxyReq.end();
  });
}

// ============================================================================
// METADATA PROXY - Study/Form Metadata
// ============================================================================

/**
 * GET /api/libreclinica/metadata/:studyOid
 * Proxies to: GET /rest/metadata/json/view/{studyOID}
 */
router.get('/metadata/:studyOid', authMiddleware, async (req: Request, res: Response) => {
  const { studyOid } = req.params;
  const format = req.query.format || 'json';
  
  const path = format === 'xml' 
    ? `/rest/metadata/xml/view/${studyOid}`
    : `/rest/metadata/json/view/${studyOid}`;
  
  await proxyToLibreClinica(path, req, res);
});

/**
 * GET /api/libreclinica/metadata/:studyOid/:eventOid/:formVersionOid/print
 * Proxies to: GET /rest/metadata/html/print/{studyOID}/{eventOID}/{formVersionOID}
 */
router.get('/metadata/:studyOid/:eventOid/:formVersionOid/print', authMiddleware, async (req: Request, res: Response) => {
  const { studyOid, eventOid, formVersionOid } = req.params;
  const format = req.query.format || 'html';
  
  const path = format === 'pdf'
    ? `/rest/metadata/pdf/print/${studyOid}/${eventOid}/${formVersionOid}`
    : `/rest/metadata/html/print/${studyOid}/${eventOid}/${formVersionOid}`;
  
  await proxyToLibreClinica(path, req, res);
});

// ============================================================================
// CLINICAL DATA PROXY - Subject/Form Data
// ============================================================================

/**
 * GET /api/libreclinica/clinicaldata/:studyOid/:subjectId/:eventOid/:formVersionOid
 * Proxies to: GET /rest/clinicaldata/json/view/{studyOID}/{subjectId}/{eventOID}/{formVersionOID}
 */
router.get('/clinicaldata/:studyOid/:subjectId/:eventOid/:formVersionOid', authMiddleware, async (req: Request, res: Response) => {
  const { studyOid, subjectId, eventOid, formVersionOid } = req.params;
  const format = req.query.format || 'json';
  
  const path = format === 'xml'
    ? `/rest/clinicaldata/xml/view/${studyOid}/${subjectId}/${eventOid}/${formVersionOid}`
    : `/rest/clinicaldata/json/view/${studyOid}/${subjectId}/${eventOid}/${formVersionOid}`;
  
  await proxyToLibreClinica(path, req, res);
});

/**
 * GET /api/libreclinica/clinicaldata/:studyOid/:subjectId/:eventOid/:formVersionOid/print
 * Proxies to: GET /rest/clinicaldata/html/print/{...}
 */
router.get('/clinicaldata/:studyOid/:subjectId/:eventOid/:formVersionOid/print', authMiddleware, async (req: Request, res: Response) => {
  const { studyOid, subjectId, eventOid, formVersionOid } = req.params;
  const includeDns = req.query.includeDns || 'n';
  
  const path = `/rest/clinicaldata/html/print/${studyOid}/${subjectId}/${eventOid}/${formVersionOid}?includeDNs=${includeDns}`;
  
  await proxyToLibreClinica(path, req, res);
});

// ============================================================================
// OPENROSA PROXY - ODK-Compatible API
// ============================================================================

/**
 * GET /api/libreclinica/openrosa/:studyOid/formList
 * Proxies to: GET /rest/openrosa/{studyOID}/formList
 */
router.get('/openrosa/:studyOid/formList', authMiddleware, async (req: Request, res: Response) => {
  const { studyOid } = req.params;
  await proxyToLibreClinica(`/rest/openrosa/${studyOid}/formList`, req, res);
});

/**
 * GET /api/libreclinica/openrosa/:studyOid/manifest
 * Proxies to: GET /rest/openrosa/{studyOID}/manifest
 */
router.get('/openrosa/:studyOid/manifest', authMiddleware, async (req: Request, res: Response) => {
  const { studyOid } = req.params;
  await proxyToLibreClinica(`/rest/openrosa/${studyOid}/manifest`, req, res);
});

/**
 * GET /api/libreclinica/openrosa/:studyOid/formXml
 * Proxies to: GET /rest/openrosa/{studyOID}/formXml
 */
router.get('/openrosa/:studyOid/formXml', authMiddleware, async (req: Request, res: Response) => {
  const { studyOid } = req.params;
  const formId = req.query.formId;
  await proxyToLibreClinica(`/rest/openrosa/${studyOid}/formXml?formId=${formId}`, req, res);
});

/**
 * POST /api/libreclinica/openrosa/:studyOid/submission
 * Proxies to: POST /rest/openrosa/{studyOID}/submission
 */
router.post('/openrosa/:studyOid/submission', authMiddleware, async (req: Request, res: Response) => {
  const { studyOid } = req.params;
  await proxyToLibreClinica(`/rest/openrosa/${studyOid}/submission`, req, res, {
    method: 'POST',
    body: req.body
  });
});

// ============================================================================
// SYSTEM STATUS PROXY
// ============================================================================

/**
 * GET /api/libreclinica/system/status
 * Proxies to: POST /auth/api/v1/system/systemstatus
 */
router.get('/system/status', async (req: Request, res: Response) => {
  await proxyToLibreClinica('/auth/api/v1/system/systemstatus', req, res, { method: 'POST' });
});

/**
 * GET /api/libreclinica/system/config
 * Proxies to: GET /auth/api/v1/system/config
 */
router.get('/system/config', authMiddleware, async (req: Request, res: Response) => {
  await proxyToLibreClinica('/auth/api/v1/system/config', req, res);
});

// ============================================================================
// AVAILABILITY CHECK
// ============================================================================

/**
 * GET /api/libreclinica/available
 * Check if LibreClinica Core is reachable
 */
router.get('/available', async (req: Request, res: Response) => {
  try {
    const url = new URL('/LibreClinica', LIBRECLINICA_BASE);
    const client = url.protocol === 'https:' ? https : http;
    
    const available = await new Promise<boolean>((resolve) => {
      const request = client.get(url.toString(), { timeout: 5000 }, (response) => {
        resolve(response.statusCode === 200 || response.statusCode === 302);
      });
      request.on('error', () => resolve(false));
      request.on('timeout', () => {
        request.destroy();
        resolve(false);
      });
    });

    res.json({
      success: true,
      data: {
        available,
        url: LIBRECLINICA_BASE,
        nativeRestEndpoints: available ? [
          '/rest/metadata/*',
          '/rest/clinicaldata/*',
          '/rest/openrosa/*',
          '/auth/api/v1/system/*'
        ] : [],
        message: available 
          ? 'LibreClinica Core is available' 
          : 'LibreClinica Core is not reachable'
      }
    });
  } catch (error: any) {
    res.json({
      success: false,
      data: {
        available: false,
        url: LIBRECLINICA_BASE,
        error: error.message
      }
    });
  }
});

export default router;

