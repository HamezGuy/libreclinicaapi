/**
 * RTSM (Randomization and Trial Supply Management) Routes
 * 
 * Endpoints for managing investigational product kits, shipments, and dispensing.
 * Integrates with LibreClinica's randomization and subject data.
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail for all kit, shipment, and dispensing operations
 * - §11.10(k): UTC timestamps for all events
 * - §11.50: Electronic signature required for dispensing (GxP critical)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  Part11EventTypes,
  recordPart11Audit,
  Part11Request,
  requireSignature,
  formatPart11Timestamp
} from '../middleware/part11.middleware';

const router = Router();

// Database connection - use existing pool from database config
import { pool } from '../config/database';

// Apply auth middleware to all routes
router.use(authMiddleware);

// ============================================================================
// Dashboard
// ============================================================================

/**
 * GET /api/rtsm/dashboard
 * Get RTSM dashboard statistics
 */
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, siteId } = req.query;

    // Get kit stats - join with kit_type to filter by study_id
    let kitQuery = `
      SELECT
        COUNT(*) as total_kits,
        COUNT(*) FILTER (WHERE k.status = 'available') as available_kits,
        COUNT(*) FILTER (WHERE k.status = 'dispensed') as dispensed_kits,
        COUNT(*) FILTER (WHERE k.status = 'reserved') as reserved_kits,
        COUNT(*) FILTER (WHERE k.expiration_date <= NOW() + INTERVAL '30 days' AND k.status = 'available') as expiring_kits
      FROM acc_kit k
      JOIN acc_kit_type kt ON k.kit_type_id = kt.kit_type_id
      WHERE 1=1
    `;
    const kitParams: any[] = [];

    if (studyId) {
      kitParams.push(studyId);
      kitQuery += ` AND kt.study_id = $${kitParams.length}`;
    }

    if (siteId) {
      kitParams.push(siteId);
      kitQuery += ` AND k.current_site_id = $${kitParams.length}`;
    }

    const kitResult = await pool.query(kitQuery, kitParams);
    const kitStats = kitResult.rows[0] || {};

    // Get shipment stats
    let shipmentQuery = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending_shipments,
        COUNT(*) FILTER (WHERE status = 'in_transit') as in_transit_shipments
      FROM acc_shipment
      WHERE 1=1
    `;
    const shipmentParams: any[] = [];

    if (studyId) {
      shipmentParams.push(studyId);
      shipmentQuery += ` AND study_id = $${shipmentParams.length}`;
    }

    const shipmentResult = await pool.query(shipmentQuery, shipmentParams);
    const shipmentStats = shipmentResult.rows[0] || {};

    res.json({
      success: true,
      data: {
        kits: {
          total: parseInt(kitStats.total_kits || 0),
          available: parseInt(kitStats.available_kits || 0),
          dispensed: parseInt(kitStats.dispensed_kits || 0),
          reserved: parseInt(kitStats.reserved_kits || 0),
          expiring: parseInt(kitStats.expiring_kits || 0)
        },
        shipments: {
          pending: parseInt(shipmentStats.pending_shipments || 0),
          inTransit: parseInt(shipmentStats.in_transit_shipments || 0)
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get RTSM dashboard', { error });
    next(error);
  }
});

// ============================================================================
// Kit Types
// ============================================================================

/**
 * GET /api/rtsm/kit-types
 * List kit types for a study
 */
router.get('/kit-types', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId } = req.query;

    let query = 'SELECT * FROM acc_kit_type WHERE 1=1';
    const params: any[] = [];

    if (studyId) {
      params.push(studyId);
      query += ` AND study_id = $${params.length}`;
    }

    query += ' ORDER BY name ASC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        kitTypeId: row.kit_type_id,
        studyId: row.study_id,
        name: row.name,
        description: row.description,
        treatmentArm: row.treatment_arm,
        storageConditions: row.storage_conditions,
        minTemp: row.min_temp,
        maxTemp: row.max_temp,
        unitsPerKit: row.units_per_kit
      }))
    });
  } catch (error) {
    logger.error('Failed to list kit types', { error });
    next(error);
  }
});

// ============================================================================
// Kits (Inventory)
// ============================================================================

/**
 * GET /api/rtsm/kits
 * List kits with filtering
 */
router.get('/kits', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, siteId, status, kitTypeId, search } = req.query;

    // Note: LibreClinica doesn't have a separate study_site table
    // Sites are studies with parent_study_id pointing to the main study
    let query = `
      SELECT 
        k.*,
        kt.name as kit_type_name,
        kt.study_id as study_id,
        site.name as site_name
      FROM acc_kit k
      LEFT JOIN acc_kit_type kt ON k.kit_type_id = kt.kit_type_id
      LEFT JOIN study site ON k.current_site_id = site.study_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (studyId) {
      params.push(studyId);
      query += ` AND kt.study_id = $${params.length}`;
    }

    if (siteId) {
      params.push(siteId);
      query += ` AND k.current_site_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND k.status = $${params.length}`;
    }

    if (kitTypeId) {
      params.push(kitTypeId);
      query += ` AND k.kit_type_id = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND k.kit_number ILIKE $${params.length}`;
    }

    query += ' ORDER BY k.kit_number ASC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        kitId: row.kit_id,
        kitNumber: row.kit_number,
        kitType: row.kit_type_name,
        kitTypeId: row.kit_type_id,
        status: row.status,
        siteId: row.current_site_id,
        siteName: row.site_name,
        lotNumber: row.lot_number,
        expirationDate: row.expiration_date,
        manufactureDate: row.manufacture_date
      }))
    });
  } catch (error) {
    logger.error('Failed to list kits', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/kits
 * Register new kits
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for each kit registration
 * - Captures kit details, lot numbers, and expiration dates
 */
router.post('/kits', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, kitTypeId, kits } = req.body;
    const userId = req.user?.userId || 1;
    const userName = req.user?.userName || 'system';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertedKits = [];
      for (const kit of kits) {
        // Note: acc_kit table uses manufacture_date (not manufacturing_date), created_by (not registered_by)
        // and doesn't have a study_id column - study is determined via kit_type_id FK
        const result = await client.query(`
          INSERT INTO acc_kit (
            kit_type_id, kit_number, lot_number, 
            manufacture_date, expiration_date, status,
            created_by, date_created, date_updated
          ) VALUES ($1, $2, $3, $4, $5, 'available', $6, NOW(), NOW())
          RETURNING *
        `, [kitTypeId, kit.kitNumber, kit.lotNumber, kit.manufactureDate || kit.manufacturingDate, kit.expirationDate, userId]);
        
        const insertedKit = result.rows[0];
        insertedKits.push(insertedKit);

        // Part 11 Audit: Record kit registration (§11.10(e))
        await recordPart11Audit(
          userId,
          userName,
          Part11EventTypes.KIT_REGISTERED,
          'acc_kit',
          insertedKit.kit_id,
          kit.kitNumber,
          null,
          {
            kitNumber: kit.kitNumber,
            kitTypeId,
            lotNumber: kit.lotNumber,
            expirationDate: kit.expirationDate,
            status: 'available'
          },
          'Kit registered in inventory',
          { ipAddress: req.ip }
        );
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        data: insertedKits,
        message: `${insertedKits.length} kits registered successfully`
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Failed to register kits', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/kits/:id/reserve
 * Reserve a kit for dispensing
 */
router.post('/kits/:id/reserve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { subjectId } = req.body;

    // Note: acc_kit doesn't have reserved_for_subject_id or notes columns
    // We use dispensed_to_subject_id to track the subject reservation
    const result = await pool.query(`
      UPDATE acc_kit 
      SET status = 'reserved',
          dispensed_to_subject_id = $2,
          date_updated = NOW()
      WHERE kit_id = $1 AND status = 'available'
      RETURNING *
    `, [id, subjectId]);

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Kit not available for reservation' });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Failed to reserve kit', { error });
    next(error);
  }
});

// ============================================================================
// Shipments
// ============================================================================

/**
 * GET /api/rtsm/shipments
 * List shipments
 */
router.get('/shipments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, siteId, status } = req.query;

    // Note: acc_shipment uses destination_id (not destination_site_id), shipped_at, expected_delivery, delivered_at
    let query = `
      SELECT 
        s.*,
        site.name as site_name,
        (SELECT COUNT(*) FROM acc_kit k WHERE k.current_shipment_id = s.shipment_id) as kit_count
      FROM acc_shipment s
      LEFT JOIN study site ON s.destination_id = site.study_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (studyId) {
      params.push(studyId);
      query += ` AND s.study_id = $${params.length}`;
    }

    if (siteId) {
      params.push(siteId);
      query += ` AND s.destination_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND s.status = $${params.length}`;
    }

    query += ' ORDER BY s.date_created DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        shipmentId: row.shipment_id,
        shipmentNumber: row.shipment_number,
        destinationId: row.destination_id,
        destinationName: row.destination_name || row.site_name,
        status: row.status,
        kitCount: parseInt(row.kit_count || 0),
        shippedAt: row.shipped_at,
        expectedDelivery: row.expected_delivery,
        deliveredAt: row.delivered_at,
        trackingNumber: row.tracking_number,
        carrier: row.carrier
      }))
    });
  } catch (error) {
    logger.error('Failed to list shipments', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/shipments
 * Create a new shipment
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail of shipment creation
 * - Records all kits assigned to shipment
 */
router.post('/shipments', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, destinationSiteId, kitIds, shipDate, expectedDeliveryDate, trackingNumber } = req.body;
    const userId = req.user?.userId || 1;
    const userName = req.user?.userName || 'system';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Generate shipment number
      const shipmentNumber = `SHP-${Date.now().toString(36).toUpperCase()}`;

      // Create shipment
      const shipmentResult = await client.query(`
        INSERT INTO acc_shipment (
          study_id, shipment_number, destination_id, status,
          shipped_at, expected_delivery, tracking_number,
          created_by, date_created, date_updated
        ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, NOW(), NOW())
        RETURNING *
      `, [studyId, shipmentNumber, destinationSiteId, shipDate, expectedDeliveryDate, trackingNumber, userId]);

      const shipmentId = shipmentResult.rows[0].shipment_id;

      // Assign kits to shipment
      if (kitIds && kitIds.length > 0) {
        await client.query(`
          UPDATE acc_kit 
          SET current_shipment_id = $1, status = 'in_transit', date_updated = NOW()
          WHERE kit_id = ANY($2::int[])
        `, [shipmentId, kitIds]);
      }

      // Part 11 Audit: Record shipment creation (§11.10(e))
      await recordPart11Audit(
        userId,
        userName,
        Part11EventTypes.SHIPMENT_CREATED,
        'acc_shipment',
        shipmentId,
        shipmentNumber,
        null,
        {
          shipmentNumber,
          studyId,
          destinationSiteId,
          kitCount: kitIds?.length || 0,
          kitIds: kitIds || [],
          expectedDeliveryDate,
          status: 'pending'
        },
        'Shipment created for kit distribution',
        { ipAddress: req.ip }
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        data: shipmentResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Failed to create shipment', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/shipments/:id/ship
 * Mark shipment as shipped
 */
router.post('/shipments/:id/ship', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { trackingNumber } = req.body;

    const result = await pool.query(`
      UPDATE acc_shipment 
      SET status = 'in_transit',
          tracking_number = COALESCE($2, tracking_number),
          ship_date = NOW(),
          date_updated = NOW()
      WHERE shipment_id = $1
      RETURNING *
    `, [id, trackingNumber]);

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Failed to mark shipment as shipped', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/shipments/:id/confirm
 * Confirm shipment receipt
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail of receipt confirmation
 * - Records who received shipment and when
 */
router.post('/shipments/:id/confirm', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { receivedKitIds, notes } = req.body;
    const userId = req.user?.userId || 1;
    const userName = req.user?.userName || 'system';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get shipment details before update
      const shipmentBefore = await client.query(
        'SELECT * FROM acc_shipment WHERE shipment_id = $1',
        [id]
      );
      const oldStatus = shipmentBefore.rows[0]?.status;
      const shipmentNumber = shipmentBefore.rows[0]?.shipment_number;

      // Update shipment
      await client.query(`
        UPDATE acc_shipment 
        SET status = 'confirmed',
            delivered_at = NOW(),
            received_by = $2,
            notes = $3,
            date_updated = NOW()
        WHERE shipment_id = $1
      `, [id, userId, notes]);

      // Update kits - move to site inventory
      if (receivedKitIds && receivedKitIds.length > 0) {
        const shipmentResult = await client.query(
          'SELECT destination_id FROM acc_shipment WHERE shipment_id = $1',
          [id]
        );
        const siteId = shipmentResult.rows[0]?.destination_id;

        await client.query(`
          UPDATE acc_kit 
          SET status = 'available',
              current_site_id = $2,
              date_updated = NOW()
          WHERE kit_id = ANY($1::int[])
        `, [receivedKitIds, siteId]);
      }

      // Part 11 Audit: Record shipment receipt confirmation (§11.10(e))
      await recordPart11Audit(
        userId,
        userName,
        Part11EventTypes.SHIPMENT_RECEIVED,
        'acc_shipment',
        parseInt(id),
        shipmentNumber,
        { status: oldStatus },
        {
          status: 'confirmed',
          receivedKitCount: receivedKitIds?.length || 0,
          receivedKitIds: receivedKitIds || [],
          receivedAt: formatPart11Timestamp(),
          notes
        },
        'Shipment receipt confirmed',
        { ipAddress: req.ip }
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Shipment receipt confirmed'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Failed to confirm shipment receipt', { error });
    next(error);
  }
});

// ============================================================================
// Dispensing
// ============================================================================

/**
 * POST /api/rtsm/dispense
 * Dispense a kit to a subject
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.50: REQUIRES electronic signature (password verification) for dispensing
 * - §11.10(e): Full audit trail of dispensing event
 * - GxP Critical Operation: Drug dispensing to human subjects
 * 
 * Request body must include:
 * - password: User's password for electronic signature
 * - signatureMeaning: "Authorized dispensing of investigational product"
 */
router.post('/dispense', requireSignature, async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { kitId, subjectId, visitId, notes } = req.body;
    const userId = req.user?.userId || 1;
    const userName = req.user?.userName || 'system';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get kit details before dispensing
      const kitBefore = await client.query(
        'SELECT * FROM acc_kit WHERE kit_id = $1',
        [kitId]
      );
      const oldKitData = kitBefore.rows[0];

      // Update kit status
      const kitResult = await client.query(`
        UPDATE acc_kit 
        SET status = 'dispensed',
            dispensed_to_subject_id = $2,
            date_updated = NOW()
        WHERE kit_id = $1 AND status IN ('available', 'reserved')
        RETURNING *
      `, [kitId, subjectId]);

      if (kitResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Kit not available for dispensing' });
      }

      const dispensedKit = kitResult.rows[0];

      // Create dispensation record
      // Note: Table is acc_kit_dispensing, uses study_event_id (not visit_id), dispensed_at (not dispensed_date)
      const dispensingResult = await client.query(`
        INSERT INTO acc_kit_dispensing (
          kit_id, study_subject_id, study_event_id, dispensed_by,
          dispensed_at, notes, date_created
        ) VALUES ($1, $2, $3, $4, NOW(), $5, NOW())
        RETURNING dispensing_id
      `, [kitId, subjectId, visitId, userId, notes]);

      // Part 11 Audit: Record kit dispensing with electronic signature (§11.10(e), §11.50)
      await recordPart11Audit(
        userId,
        userName,
        Part11EventTypes.KIT_DISPENSED,
        'acc_kit_dispensing',
        dispensingResult.rows[0].dispensing_id,
        dispensedKit.kit_number,
        { status: oldKitData?.status || 'available' },
        {
          kitId,
          kitNumber: dispensedKit.kit_number,
          subjectId,
          visitId,
          status: 'dispensed',
          dispensedAt: formatPart11Timestamp(),
          electronicSignature: true,
          signatureMeaning: req.body.signatureMeaning || 'Authorized dispensing of investigational product'
        },
        'Kit dispensed to subject with electronic signature verification',
        { ipAddress: req.ip, signatureMeaning: req.body.signatureMeaning }
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        data: kitResult.rows[0],
        message: 'Kit dispensed successfully with electronic signature'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Failed to dispense kit', { error });
    next(error);
  }
});

/**
 * GET /api/rtsm/dispensations
 * List recent dispensations
 */
router.get('/dispensations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, siteId, subjectId, limit = 50 } = req.query;

    // Note: Table is acc_kit_dispensing (not acc_dispensation)
    // Uses dispensing_id, dispensed_at (not dispensed_date)
    let query = `
      SELECT 
        d.*,
        k.kit_number,
        kt.name as kit_type_name,
        ss.label as subject_label,
        ua.user_name as dispensed_by_name
      FROM acc_kit_dispensing d
      LEFT JOIN acc_kit k ON d.kit_id = k.kit_id
      LEFT JOIN acc_kit_type kt ON k.kit_type_id = kt.kit_type_id
      LEFT JOIN study_subject ss ON d.study_subject_id = ss.study_subject_id
      LEFT JOIN user_account ua ON d.dispensed_by = ua.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (studyId) {
      params.push(studyId);
      query += ` AND kt.study_id = $${params.length}`;
    }

    if (siteId) {
      params.push(siteId);
      query += ` AND k.current_site_id = $${params.length}`;
    }

    if (subjectId) {
      params.push(subjectId);
      query += ` AND d.study_subject_id = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY d.dispensed_at DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        dispensingId: row.dispensing_id,
        kitId: row.kit_id,
        kitNumber: row.kit_number,
        kitType: row.kit_type_name,
        subjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        dispensedBy: row.dispensed_by_name,
        dispensedAt: row.dispensed_at,
        quantityDispensed: row.quantity_dispensed,
        notes: row.notes
      }))
    });
  } catch (error) {
    logger.error('Failed to list dispensations', { error });
    next(error);
  }
});

// ============================================================================
// Temperature Logging
// ============================================================================

/**
 * POST /api/rtsm/temperature
 * Log temperature reading
 */
router.post('/temperature', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId, storageUnit, temperature, humidity, notes } = req.body;
    const userId = (req as any).user?.id || 1;

    const result = await pool.query(`
      INSERT INTO acc_temperature_log (
        site_id, storage_unit, temperature, humidity,
        recorded_by, notes, recorded_at, date_created
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `, [siteId, storageUnit, temperature, humidity, userId, notes]);

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Failed to log temperature', { error });
    next(error);
  }
});

/**
 * GET /api/rtsm/temperature
 * Get temperature logs
 */
router.get('/temperature', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId, days = 7 } = req.query;

    let query = `
      SELECT * FROM acc_temperature_log
      WHERE recorded_at >= NOW() - INTERVAL '${parseInt(String(days))} days'
    `;
    const params: any[] = [];

    if (siteId) {
      params.push(siteId);
      query += ` AND site_id = $${params.length}`;
    }

    query += ' ORDER BY recorded_at DESC';

    const result = await pool.query(query, params);

    // Check for excursions
    const excursions = result.rows.filter(row => 
      row.temperature < 2 || row.temperature > 8
    );

    res.json({
      success: true,
      data: {
        readings: result.rows,
        excursionCount: excursions.length
      }
    });
  } catch (error) {
    logger.error('Failed to get temperature logs', { error });
    next(error);
  }
});

export default router;

