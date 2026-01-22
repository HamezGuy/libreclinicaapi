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

      // Get destination site name
      const siteResult = await client.query(
        'SELECT name FROM study WHERE study_id = $1',
        [destinationSiteId]
      );
      const destinationName = siteResult.rows[0]?.name || 'Site';

      // Create shipment
      // Table requires: source_type, destination_type (NOT NULL)
      const shipmentResult = await client.query(`
        INSERT INTO acc_shipment (
          study_id, shipment_number, shipment_type,
          source_type, source_name, destination_type, destination_id, destination_name,
          status, tracking_number, expected_delivery,
          requested_by, requested_at, date_created, date_updated
        ) VALUES ($1, $2, 'outbound', 'depot', 'Central Depot', 'site', $3, $4, 
                  'pending', $5, $6, $7, NOW(), NOW(), NOW())
        RETURNING *
      `, [studyId, shipmentNumber, destinationSiteId, destinationName, trackingNumber, expectedDeliveryDate, userId]);

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
 * Table column is shipped_at (not ship_date)
 */
router.post('/shipments/:id/ship', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { trackingNumber } = req.body;
    const userId = (req as any).user?.userId || 1;

    const result = await pool.query(`
      UPDATE acc_shipment 
      SET status = 'in_transit',
          tracking_number = COALESCE($2, tracking_number),
          shipped_at = NOW(),
          shipped_by = $3,
          date_updated = NOW()
      WHERE shipment_id = $1
      RETURNING *
    `, [id, trackingNumber, userId]);

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
      // Table has receipt_notes column (not notes), status 'delivered' (not 'confirmed')
      await client.query(`
        UPDATE acc_shipment 
        SET status = 'delivered',
            delivered_at = NOW(),
            received_by = $2,
            receipt_notes = $3,
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
 * 
 * Table: acc_temperature_log
 * Columns: log_id, entity_type, entity_id, recorded_at, temperature, humidity,
 *          is_excursion, excursion_duration_minutes, recorded_by, device_id, notes, date_created
 */
router.post('/temperature', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId, storageUnit, temperature, humidity, notes, deviceId } = req.body;
    const userId = (req as any).user?.userId || 1;

    // Check for temperature excursion (typical 2-8°C range for refrigerated storage)
    const isExcursion = temperature < 2 || temperature > 8;

    // Table uses entity_type/entity_id pattern - siteId becomes entity_id, storageUnit goes in notes
    const result = await pool.query(`
      INSERT INTO acc_temperature_log (
        entity_type, entity_id, recorded_at, temperature, humidity,
        is_excursion, recorded_by, device_id, notes, date_created
      ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [
      'site_storage', 
      siteId, 
      temperature, 
      humidity, 
      isExcursion,
      userId, 
      deviceId || storageUnit, // Use storageUnit as device identifier if no deviceId
      notes ? `${storageUnit}: ${notes}` : storageUnit
    ]);

    res.json({
      success: true,
      data: {
        logId: result.rows[0].log_id,
        temperature: result.rows[0].temperature,
        humidity: result.rows[0].humidity,
        isExcursion: result.rows[0].is_excursion,
        recordedAt: result.rows[0].recorded_at
      }
    });
  } catch (error) {
    logger.error('Failed to log temperature', { error });
    next(error);
  }
});

/**
 * GET /api/rtsm/temperature
 * Get temperature logs
 * 
 * Table: acc_temperature_log uses entity_type/entity_id pattern
 */
router.get('/temperature', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId, days = 7 } = req.query;

    let query = `
      SELECT 
        log_id, entity_type, entity_id, recorded_at, temperature, humidity,
        is_excursion, excursion_duration_minutes, recorded_by, device_id, notes, date_created
      FROM acc_temperature_log
      WHERE recorded_at >= NOW() - INTERVAL '${parseInt(String(days))} days'
        AND entity_type = 'site_storage'
    `;
    const params: any[] = [];

    if (siteId) {
      params.push(siteId);
      query += ` AND entity_id = $${params.length}`;
    }

    query += ' ORDER BY recorded_at DESC';

    const result = await pool.query(query, params);

    // Count excursions using the is_excursion column
    const excursionCount = result.rows.filter(row => row.is_excursion === true).length;

    res.json({
      success: true,
      data: {
        readings: result.rows.map(row => ({
          logId: row.log_id,
          siteId: row.entity_id,
          temperature: parseFloat(row.temperature),
          humidity: row.humidity ? parseFloat(row.humidity) : null,
          isExcursion: row.is_excursion,
          recordedAt: row.recorded_at,
          deviceId: row.device_id,
          notes: row.notes
        })),
        excursionCount
      }
    });
  } catch (error) {
    logger.error('Failed to get temperature logs', { error });
    next(error);
  }
});

// ============================================================================
// Inventory Alerts (acc_inventory_alert table)
// ============================================================================

/**
 * GET /api/rtsm/alerts
 * List inventory alerts with filtering
 * 
 * Table: acc_inventory_alert
 * Columns: alert_id, study_id, site_id, kit_type_id, alert_type, severity,
 *          message, threshold_value, current_value, status, acknowledged_at,
 *          acknowledged_by, resolved_at, resolved_by, date_created
 */
router.get('/alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, siteId, status, alertType, severity } = req.query;

    let query = `
      SELECT 
        a.*,
        s.name as study_name,
        site.name as site_name,
        kt.name as kit_type_name,
        CONCAT(ack_user.first_name, ' ', ack_user.last_name) as acknowledged_by_name,
        CONCAT(res_user.first_name, ' ', res_user.last_name) as resolved_by_name
      FROM acc_inventory_alert a
      LEFT JOIN study s ON a.study_id = s.study_id
      LEFT JOIN study site ON a.site_id = site.study_id
      LEFT JOIN acc_kit_type kt ON a.kit_type_id = kt.kit_type_id
      LEFT JOIN user_account ack_user ON a.acknowledged_by = ack_user.user_id
      LEFT JOIN user_account res_user ON a.resolved_by = res_user.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (studyId) {
      params.push(studyId);
      query += ` AND a.study_id = $${params.length}`;
    }

    if (siteId) {
      params.push(siteId);
      query += ` AND a.site_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND a.status = $${params.length}`;
    }

    if (alertType) {
      params.push(alertType);
      query += ` AND a.alert_type = $${params.length}`;
    }

    if (severity) {
      params.push(severity);
      query += ` AND a.severity = $${params.length}`;
    }

    query += ' ORDER BY a.date_created DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        alertId: row.alert_id,
        studyId: row.study_id,
        studyName: row.study_name,
        siteId: row.site_id,
        siteName: row.site_name,
        kitTypeId: row.kit_type_id,
        kitTypeName: row.kit_type_name,
        alertType: row.alert_type,
        severity: row.severity,
        message: row.message,
        thresholdValue: row.threshold_value,
        currentValue: row.current_value,
        status: row.status,
        acknowledgedAt: row.acknowledged_at,
        acknowledgedBy: row.acknowledged_by,
        acknowledgedByName: row.acknowledged_by_name,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        resolvedByName: row.resolved_by_name,
        dateCreated: row.date_created
      }))
    });
  } catch (error) {
    logger.error('Failed to list inventory alerts', { error });
    next(error);
  }
});

/**
 * GET /api/rtsm/alerts/:id
 * Get a specific inventory alert
 */
router.get('/alerts/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT 
        a.*,
        s.name as study_name,
        site.name as site_name,
        kt.name as kit_type_name,
        CONCAT(ack_user.first_name, ' ', ack_user.last_name) as acknowledged_by_name,
        CONCAT(res_user.first_name, ' ', res_user.last_name) as resolved_by_name
      FROM acc_inventory_alert a
      LEFT JOIN study s ON a.study_id = s.study_id
      LEFT JOIN study site ON a.site_id = site.study_id
      LEFT JOIN acc_kit_type kt ON a.kit_type_id = kt.kit_type_id
      LEFT JOIN user_account ack_user ON a.acknowledged_by = ack_user.user_id
      LEFT JOIN user_account res_user ON a.resolved_by = res_user.user_id
      WHERE a.alert_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        alertId: row.alert_id,
        studyId: row.study_id,
        studyName: row.study_name,
        siteId: row.site_id,
        siteName: row.site_name,
        kitTypeId: row.kit_type_id,
        kitTypeName: row.kit_type_name,
        alertType: row.alert_type,
        severity: row.severity,
        message: row.message,
        thresholdValue: row.threshold_value,
        currentValue: row.current_value,
        status: row.status,
        acknowledgedAt: row.acknowledged_at,
        acknowledgedByName: row.acknowledged_by_name,
        resolvedAt: row.resolved_at,
        resolvedByName: row.resolved_by_name,
        dateCreated: row.date_created
      }
    });
  } catch (error) {
    logger.error('Failed to get inventory alert', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/alerts
 * Create a new inventory alert
 * 
 * Alert types: low_stock, expiring_soon, temperature_excursion
 * Severity: info, warning, critical
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for alert creation
 */
router.post('/alerts', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { 
      studyId, 
      siteId, 
      kitTypeId, 
      alertType, 
      severity, 
      message, 
      thresholdValue, 
      currentValue 
    } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!studyId || !alertType || !message) {
      return res.status(400).json({
        success: false,
        message: 'studyId, alertType, and message are required'
      });
    }

    const result = await pool.query(`
      INSERT INTO acc_inventory_alert (
        study_id, site_id, kit_type_id, alert_type, severity,
        message, threshold_value, current_value, status, date_created
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', NOW())
      RETURNING *
    `, [
      studyId, 
      siteId || null, 
      kitTypeId || null, 
      alertType, 
      severity || 'warning', 
      message, 
      thresholdValue || null, 
      currentValue || null
    ]);

    const alertId = result.rows[0].alert_id;

    // Part 11 Audit: Record alert creation (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.INVENTORY_ALERT_CREATED || 'INVENTORY_ALERT_CREATED',
      'acc_inventory_alert',
      alertId,
      `${alertType} alert`,
      null,
      { studyId, siteId, kitTypeId, alertType, severity: severity || 'warning', message },
      'Inventory alert created',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      data: {
        alertId,
        alertType: result.rows[0].alert_type,
        severity: result.rows[0].severity,
        status: result.rows[0].status
      }
    });
  } catch (error) {
    logger.error('Failed to create inventory alert', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/alerts/:id/acknowledge
 * Acknowledge an alert
 * 
 * 21 CFR Part 11 Compliance:
 * - Records who acknowledged and when
 */
router.post('/alerts/:id/acknowledge', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get current status
    const currentResult = await pool.query(
      'SELECT status, alert_type FROM acc_inventory_alert WHERE alert_id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }

    const oldStatus = currentResult.rows[0].status;
    const alertType = currentResult.rows[0].alert_type;

    if (oldStatus !== 'open') {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot acknowledge alert with status: ${oldStatus}` 
      });
    }

    await pool.query(`
      UPDATE acc_inventory_alert
      SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2
      WHERE alert_id = $1
    `, [id, userId]);

    // Part 11 Audit: Record acknowledgement (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.INVENTORY_ALERT_ACKNOWLEDGED || 'INVENTORY_ALERT_ACKNOWLEDGED',
      'acc_inventory_alert',
      parseInt(id),
      `${alertType} alert ${id}`,
      { status: oldStatus },
      { status: 'acknowledged' },
      'Inventory alert acknowledged',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      message: 'Alert acknowledged successfully'
    });
  } catch (error) {
    logger.error('Failed to acknowledge inventory alert', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/alerts/:id/resolve
 * Resolve an alert
 * 
 * 21 CFR Part 11 Compliance:
 * - Records who resolved and when
 */
router.post('/alerts/:id/resolve', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get current status
    const currentResult = await pool.query(
      'SELECT status, alert_type FROM acc_inventory_alert WHERE alert_id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }

    const oldStatus = currentResult.rows[0].status;
    const alertType = currentResult.rows[0].alert_type;

    if (oldStatus === 'resolved') {
      return res.status(400).json({ 
        success: false, 
        message: 'Alert is already resolved' 
      });
    }

    await pool.query(`
      UPDATE acc_inventory_alert
      SET status = 'resolved', resolved_at = NOW(), resolved_by = $2
      WHERE alert_id = $1
    `, [id, userId]);

    // Part 11 Audit: Record resolution (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.INVENTORY_ALERT_RESOLVED || 'INVENTORY_ALERT_RESOLVED',
      'acc_inventory_alert',
      parseInt(id),
      `${alertType} alert ${id}`,
      { status: oldStatus },
      { status: 'resolved', notes },
      'Inventory alert resolved',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      message: 'Alert resolved successfully'
    });
  } catch (error) {
    logger.error('Failed to resolve inventory alert', { error });
    next(error);
  }
});

/**
 * GET /api/rtsm/alerts/summary
 * Get alert summary statistics
 */
router.get('/alerts/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, siteId } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (studyId) {
      params.push(studyId);
      whereClause += ` AND study_id = $${params.length}`;
    }

    if (siteId) {
      params.push(siteId);
      whereClause += ` AND site_id = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'open') as open_count,
        COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged_count,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
        COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical') as critical_count,
        COUNT(*) FILTER (WHERE status = 'open' AND severity = 'warning') as warning_count,
        COUNT(*) FILTER (WHERE alert_type = 'low_stock' AND status = 'open') as low_stock_count,
        COUNT(*) FILTER (WHERE alert_type = 'expiring_soon' AND status = 'open') as expiring_count,
        COUNT(*) FILTER (WHERE alert_type = 'temperature_excursion' AND status = 'open') as temp_excursion_count
      FROM acc_inventory_alert
      ${whereClause}
    `, params);

    const stats = result.rows[0] || {};

    res.json({
      success: true,
      data: {
        open: parseInt(stats.open_count || 0),
        acknowledged: parseInt(stats.acknowledged_count || 0),
        resolved: parseInt(stats.resolved_count || 0),
        bySeverity: {
          critical: parseInt(stats.critical_count || 0),
          warning: parseInt(stats.warning_count || 0)
        },
        byType: {
          lowStock: parseInt(stats.low_stock_count || 0),
          expiringSoon: parseInt(stats.expiring_count || 0),
          temperatureExcursion: parseInt(stats.temp_excursion_count || 0)
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get alerts summary', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/alerts/check-inventory
 * Check inventory levels and generate alerts for low stock
 * Compares current inventory against kit_type.reorder_threshold
 */
router.post('/alerts/check-inventory', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { studyId } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!studyId) {
      return res.status(400).json({ success: false, message: 'studyId is required' });
    }

    // Check each kit type's inventory against threshold
    const inventoryResult = await pool.query(`
      SELECT 
        kt.kit_type_id,
        kt.name as kit_type_name,
        kt.reorder_threshold,
        k.current_site_id as site_id,
        site.name as site_name,
        COUNT(k.kit_id) FILTER (WHERE k.status = 'available') as available_count
      FROM acc_kit_type kt
      LEFT JOIN acc_kit k ON kt.kit_type_id = k.kit_type_id
      LEFT JOIN study site ON k.current_site_id = site.study_id
      WHERE kt.study_id = $1 AND kt.reorder_threshold IS NOT NULL
      GROUP BY kt.kit_type_id, kt.name, kt.reorder_threshold, k.current_site_id, site.name
      HAVING COUNT(k.kit_id) FILTER (WHERE k.status = 'available') < kt.reorder_threshold
    `, [studyId]);

    const createdAlerts = [];

    for (const row of inventoryResult.rows) {
      // Check if alert already exists for this kit type/site combination
      const existingAlert = await pool.query(`
        SELECT alert_id FROM acc_inventory_alert
        WHERE study_id = $1 
          AND COALESCE(site_id, 0) = COALESCE($2, 0)
          AND kit_type_id = $3
          AND alert_type = 'low_stock'
          AND status IN ('open', 'acknowledged')
      `, [studyId, row.site_id, row.kit_type_id]);

      if (existingAlert.rows.length === 0) {
        // Create new alert
        const siteName = row.site_name || 'Depot';
        const result = await pool.query(`
          INSERT INTO acc_inventory_alert (
            study_id, site_id, kit_type_id, alert_type, severity,
            message, threshold_value, current_value, status, date_created
          ) VALUES ($1, $2, $3, 'low_stock', $4, $5, $6, $7, 'open', NOW())
          RETURNING alert_id
        `, [
          studyId,
          row.site_id,
          row.kit_type_id,
          parseInt(row.available_count) === 0 ? 'critical' : 'warning',
          `Low stock: ${row.kit_type_name} at ${siteName} (${row.available_count} available, threshold: ${row.reorder_threshold})`,
          row.reorder_threshold,
          parseInt(row.available_count)
        ]);

        createdAlerts.push({
          alertId: result.rows[0].alert_id,
          kitType: row.kit_type_name,
          site: siteName,
          available: parseInt(row.available_count),
          threshold: row.reorder_threshold
        });

        // Part 11 Audit
        await recordPart11Audit(
          userId,
          userName,
          Part11EventTypes.INVENTORY_ALERT_CREATED || 'INVENTORY_ALERT_CREATED',
          'acc_inventory_alert',
          result.rows[0].alert_id,
          'low_stock alert',
          null,
          { kitTypeId: row.kit_type_id, available: parseInt(row.available_count), threshold: row.reorder_threshold },
          'Low stock alert auto-generated',
          { ipAddress: req.ip }
        );
      }
    }

    res.json({
      success: true,
      message: `${createdAlerts.length} low stock alerts created`,
      data: { alerts: createdAlerts }
    });
  } catch (error) {
    logger.error('Failed to check inventory levels', { error });
    next(error);
  }
});

/**
 * POST /api/rtsm/alerts/check-expiry
 * Check for expiring kits and generate alerts
 */
router.post('/alerts/check-expiry', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, daysAhead = 30 } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!studyId) {
      return res.status(400).json({ success: false, message: 'studyId is required' });
    }

    // Find kits expiring within daysAhead
    const expiringResult = await pool.query(`
      SELECT 
        kt.kit_type_id,
        kt.name as kit_type_name,
        k.current_site_id as site_id,
        site.name as site_name,
        COUNT(k.kit_id) as expiring_count,
        MIN(k.expiration_date) as earliest_expiry
      FROM acc_kit k
      JOIN acc_kit_type kt ON k.kit_type_id = kt.kit_type_id
      LEFT JOIN study site ON k.current_site_id = site.study_id
      WHERE kt.study_id = $1 
        AND k.status = 'available'
        AND k.expiration_date <= NOW() + INTERVAL '${parseInt(String(daysAhead))} days'
      GROUP BY kt.kit_type_id, kt.name, k.current_site_id, site.name
    `, [studyId]);

    const createdAlerts = [];

    for (const row of expiringResult.rows) {
      // Check if alert already exists
      const existingAlert = await pool.query(`
        SELECT alert_id FROM acc_inventory_alert
        WHERE study_id = $1 
          AND COALESCE(site_id, 0) = COALESCE($2, 0)
          AND kit_type_id = $3
          AND alert_type = 'expiring_soon'
          AND status IN ('open', 'acknowledged')
      `, [studyId, row.site_id, row.kit_type_id]);

      if (existingAlert.rows.length === 0) {
        const siteName = row.site_name || 'Depot';
        const daysUntilExpiry = Math.ceil((new Date(row.earliest_expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        const result = await pool.query(`
          INSERT INTO acc_inventory_alert (
            study_id, site_id, kit_type_id, alert_type, severity,
            message, current_value, status, date_created
          ) VALUES ($1, $2, $3, 'expiring_soon', $4, $5, $6, 'open', NOW())
          RETURNING alert_id
        `, [
          studyId,
          row.site_id,
          row.kit_type_id,
          daysUntilExpiry <= 7 ? 'critical' : 'warning',
          `Expiring kits: ${row.expiring_count} ${row.kit_type_name} kits at ${siteName} expire within ${daysAhead} days (earliest: ${row.earliest_expiry})`,
          parseInt(row.expiring_count)
        ]);

        createdAlerts.push({
          alertId: result.rows[0].alert_id,
          kitType: row.kit_type_name,
          site: siteName,
          count: parseInt(row.expiring_count),
          earliestExpiry: row.earliest_expiry
        });

        // Part 11 Audit
        await recordPart11Audit(
          userId,
          userName,
          Part11EventTypes.INVENTORY_ALERT_CREATED || 'INVENTORY_ALERT_CREATED',
          'acc_inventory_alert',
          result.rows[0].alert_id,
          'expiring_soon alert',
          null,
          { kitTypeId: row.kit_type_id, count: parseInt(row.expiring_count), earliestExpiry: row.earliest_expiry },
          'Expiring kits alert auto-generated',
          { ipAddress: req.ip }
        );
      }
    }

    res.json({
      success: true,
      message: `${createdAlerts.length} expiry alerts created`,
      data: { alerts: createdAlerts }
    });
  } catch (error) {
    logger.error('Failed to check kit expiry', { error });
    next(error);
  }
});

export default router;

