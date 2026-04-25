import { pool } from '../../config/database';

export interface RtsmDashboard {
  kits: { total: number; available: number; dispensed: number; reserved: number; expiring: number };
  shipments: { pending: number; inTransit: number };
}
export interface KitTypeRow {
  kitTypeId: number; studyId: number; name: string; description: string | null;
  treatmentArm: string | null; storageConditions: string | null;
  minTemp: number | null; maxTemp: number | null; unitsPerKit: number | null;
}
export interface KitRow {
  kitId: number; kitNumber: string; kitTypeName: string | null; kitTypeId: number;
  status: string; currentSiteId: number | null; siteName: string | null;
  lotNumber: string | null; expirationDate: string | null; manufactureDate: string | null;
}
export interface InsertedKit {
  kitId: number; kitTypeId: number; kitNumber: string; lotNumber: string | null;
  manufactureDate: string | null; expirationDate: string | null; status: string; dateCreated: string;
}
export interface KitInput {
  kitNumber: string; lotNumber?: string | null;
  manufactureDate?: string | null; manufacturingDate?: string | null; expirationDate?: string | null;
}
export interface ShipmentRow {
  shipmentId: number; shipmentNumber: string; destinationId: number | null;
  destinationName: string | null; siteName: string | null; status: string; kitCount: number;
  shippedAt: string | null; expectedDelivery: string | null; deliveredAt: string | null;
  trackingNumber: string | null; carrier: string | null;
}
export interface CreatedShipment {
  shipmentId: number; studyId: number; shipmentNumber: string; shipmentType: string;
  sourceType: string; sourceName: string; destinationType: string; destinationId: number;
  destinationName: string; status: string; trackingNumber: string | null;
  expectedDelivery: string | null; requestedBy: number; requestedAt: string; dateCreated: string;
}
export interface DispensationRow {
  dispensingId: number; kitId: number; kitNumber: string | null; kitTypeName: string | null;
  studySubjectId: number; subjectLabel: string | null; dispensedByName: string | null;
  dispensedAt: string; quantityDispensed: number | null; notes: string | null;
}
export interface TempReading {
  logId: number; siteId: number; temperature: number; humidity: number | null;
  isExcursion: boolean; recordedAt: string; deviceId: string | null; notes: string | null;
}
export interface AlertRow {
  alertId: number; studyId: number; studyName: string | null; siteId: number | null;
  siteName: string | null; kitTypeId: number | null; kitTypeName: string | null;
  alertType: string; severity: string; message: string;
  thresholdValue: number | null; currentValue: number | null; status: string;
  acknowledgedAt: string | null; acknowledgedBy: number | null; acknowledgedByName: string | null;
  resolvedAt: string | null; resolvedBy: number | null; resolvedByName: string | null;
  dateCreated: string;
}
export interface AlertSummary {
  open: number; acknowledged: number; resolved: number;
  bySeverity: { critical: number; warning: number };
  byType: { lowStock: number; expiringSoon: number; temperatureExcursion: number };
}
export interface CreatedAlert {
  alertId: number; kitType: string; site: string;
  available?: number; threshold?: number; count?: number; earliestExpiry?: string;
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboard(studyId?: number, siteId?: number): Promise<RtsmDashboard> {
  let kitQ = `SELECT COUNT(*) as total_kits,
    COUNT(*) FILTER (WHERE k.status = 'available') as available_kits,
    COUNT(*) FILTER (WHERE k.status = 'dispensed') as dispensed_kits,
    COUNT(*) FILTER (WHERE k.status = 'reserved') as reserved_kits,
    COUNT(*) FILTER (WHERE k.expiration_date <= NOW() + INTERVAL '30 days' AND k.status = 'available') as expiring_kits
    FROM acc_kit k JOIN acc_kit_type kt ON k.kit_type_id = kt.kit_type_id WHERE 1=1`;
  const kp: unknown[] = [];
  if (studyId) { kp.push(studyId); kitQ += ` AND kt.study_id = $${kp.length}`; }
  if (siteId) { kp.push(siteId); kitQ += ` AND k.current_site_id = $${kp.length}`; }
  const kr = await pool.query(kitQ, kp);
  const ks = kr.rows[0] || {};

  let shipQ = `SELECT COUNT(*) FILTER (WHERE status = 'pending') as pending_shipments,
    COUNT(*) FILTER (WHERE status = 'in_transit') as in_transit_shipments
    FROM acc_shipment WHERE 1=1`;
  const sp: unknown[] = [];
  if (studyId) { sp.push(studyId); shipQ += ` AND study_id = $${sp.length}`; }
  const sr = await pool.query(shipQ, sp);
  const ss = sr.rows[0] || {};

  return {
    kits: { total: parseInt(ks.totalKits || 0), available: parseInt(ks.availableKits || 0),
      dispensed: parseInt(ks.dispensedKits || 0), reserved: parseInt(ks.reservedKits || 0),
      expiring: parseInt(ks.expiringKits || 0) },
    shipments: { pending: parseInt(ss.pendingShipments || 0), inTransit: parseInt(ss.inTransitShipments || 0) },
  };
}

// ── Kit Types ────────────────────────────────────────────────────────────────

export async function listKitTypes(studyId?: number): Promise<KitTypeRow[]> {
  let q = 'SELECT * FROM acc_kit_type WHERE 1=1';
  const p: unknown[] = [];
  if (studyId) { p.push(studyId); q += ` AND study_id = $${p.length}`; }
  q += ' ORDER BY name ASC';
  const r = await pool.query(q, p);
  return r.rows.map((row: Record<string, unknown>) => ({
    kitTypeId: row.kitTypeId as number, studyId: row.studyId as number,
    name: row.name as string, description: (row.description ?? null) as string | null,
    treatmentArm: (row.treatmentArm ?? null) as string | null,
    storageConditions: (row.storageConditions ?? null) as string | null,
    minTemp: (row.minTemp ?? null) as number | null, maxTemp: (row.maxTemp ?? null) as number | null,
    unitsPerKit: (row.unitsPerKit ?? null) as number | null,
  }));
}

// ── Kits (Inventory) ────────────────────────────────────────────────────────

export async function listKits(filters: {
  studyId?: number; siteId?: number; status?: string; kitTypeId?: number; search?: string;
}): Promise<KitRow[]> {
  let q = `SELECT k.*, kt.name as kit_type_name, kt.study_id as study_id, site.name as site_name
    FROM acc_kit k LEFT JOIN acc_kit_type kt ON k.kit_type_id = kt.kit_type_id
    LEFT JOIN study site ON k.current_site_id = site.study_id WHERE 1=1`;
  const p: unknown[] = [];
  if (filters.studyId) { p.push(filters.studyId); q += ` AND kt.study_id = $${p.length}`; }
  if (filters.siteId) { p.push(filters.siteId); q += ` AND k.current_site_id = $${p.length}`; }
  if (filters.status) { p.push(filters.status); q += ` AND k.status = $${p.length}`; }
  if (filters.kitTypeId) { p.push(filters.kitTypeId); q += ` AND k.kit_type_id = $${p.length}`; }
  if (filters.search) { p.push(`%${filters.search}%`); q += ` AND k.kit_number ILIKE $${p.length}`; }
  q += ' ORDER BY k.kit_number ASC';
  const r = await pool.query(q, p);
  return r.rows.map((row: Record<string, unknown>) => ({
    kitId: row.kitId as number, kitNumber: row.kitNumber as string,
    kitTypeName: (row.kitTypeName ?? null) as string | null, kitTypeId: row.kitTypeId as number,
    status: row.status as string, currentSiteId: (row.currentSiteId ?? null) as number | null,
    siteName: (row.siteName ?? null) as string | null, lotNumber: (row.lotNumber ?? null) as string | null,
    expirationDate: (row.expirationDate ?? null) as string | null,
    manufactureDate: (row.manufactureDate ?? null) as string | null,
  }));
}

export async function registerKits(
  kitTypeId: number, kits: KitInput[], userId: number
): Promise<{ inserted: InsertedKit[]; details: { kitNumber: string; kitTypeId: number; lotNumber?: string | null; expirationDate?: string | null; kitId: number }[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted: InsertedKit[] = [];
    const details: { kitNumber: string; kitTypeId: number; lotNumber?: string | null; expirationDate?: string | null; kitId: number }[] = [];
    for (const kit of kits) {
      const r = await client.query(
        `INSERT INTO acc_kit (kit_type_id, kit_number, lot_number, manufacture_date, expiration_date, status, created_by, date_created, date_updated)
         VALUES ($1, $2, $3, $4, $5, 'available', $6, NOW(), NOW()) RETURNING *`,
        [kitTypeId, kit.kitNumber, kit.lotNumber, kit.manufactureDate || kit.manufacturingDate, kit.expirationDate, userId]);
      const row = r.rows[0];
      inserted.push({ kitId: row.kitId, kitTypeId: row.kitTypeId, kitNumber: row.kitNumber,
        lotNumber: row.lotNumber, manufactureDate: row.manufactureDate, expirationDate: row.expirationDate,
        status: row.status, dateCreated: row.dateCreated });
      details.push({ kitNumber: kit.kitNumber, kitTypeId, lotNumber: kit.lotNumber,
        expirationDate: kit.expirationDate, kitId: row.kitId });
    }
    await client.query('COMMIT');
    return { inserted, details };
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export async function reserveKit(kitId: number, subjectId: number): Promise<Record<string, unknown> | null> {
  const r = await pool.query(
    `UPDATE acc_kit SET status = 'reserved', dispensed_to_subject_id = $2, date_updated = NOW()
     WHERE kit_id = $1 AND status = 'available' RETURNING *`, [kitId, subjectId]);
  return r.rows[0] || null;
}

// ── Shipments ────────────────────────────────────────────────────────────────

export async function listShipments(filters: {
  studyId?: number; siteId?: number; status?: string;
}): Promise<ShipmentRow[]> {
  let q = `SELECT s.*, site.name as site_name,
    (SELECT COUNT(*) FROM acc_kit k WHERE k.current_shipment_id = s.shipment_id) as kit_count
    FROM acc_shipment s LEFT JOIN study site ON s.destination_id = site.study_id WHERE 1=1`;
  const p: unknown[] = [];
  if (filters.studyId) { p.push(filters.studyId); q += ` AND s.study_id = $${p.length}`; }
  if (filters.siteId) { p.push(filters.siteId); q += ` AND s.destination_id = $${p.length}`; }
  if (filters.status) { p.push(filters.status); q += ` AND s.status = $${p.length}`; }
  q += ' ORDER BY s.date_created DESC';
  const r = await pool.query(q, p);
  return r.rows.map((row: Record<string, unknown>) => ({
    shipmentId: row.shipmentId as number, shipmentNumber: row.shipmentNumber as string,
    destinationId: (row.destinationId ?? null) as number | null,
    destinationName: ((row.destinationName || row.siteName) ?? null) as string | null,
    siteName: (row.siteName ?? null) as string | null,
    status: row.status as string, kitCount: parseInt(String(row.kitCount || 0)),
    shippedAt: (row.shippedAt ?? null) as string | null,
    expectedDelivery: (row.expectedDelivery ?? null) as string | null,
    deliveredAt: (row.deliveredAt ?? null) as string | null,
    trackingNumber: (row.trackingNumber ?? null) as string | null,
    carrier: (row.carrier ?? null) as string | null,
  }));
}

export async function createShipment(data: {
  studyId: number; destinationSiteId: number; kitIds?: number[];
  trackingNumber?: string; expectedDeliveryDate?: string;
}, userId: number): Promise<CreatedShipment> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shipmentNumber = `SHP-${Date.now().toString(36).toUpperCase()}`;
    const siteR = await client.query('SELECT name FROM study WHERE study_id = $1', [data.destinationSiteId]);
    const destName = siteR.rows[0]?.name || 'Site';
    const sr = await client.query(
      `INSERT INTO acc_shipment (study_id, shipment_number, shipment_type, source_type, source_name,
        destination_type, destination_id, destination_name, status, tracking_number, expected_delivery,
        requested_by, requested_at, date_created, date_updated)
       VALUES ($1, $2, 'outbound', 'depot', 'Central Depot', 'site', $3, $4, 'pending', $5, $6, $7, NOW(), NOW(), NOW()) RETURNING *`,
      [data.studyId, shipmentNumber, data.destinationSiteId, destName, data.trackingNumber, data.expectedDeliveryDate, userId]);
    const shipmentId = sr.rows[0].shipmentId;
    if (data.kitIds && data.kitIds.length > 0) {
      await client.query(
        `UPDATE acc_kit SET current_shipment_id = $1, status = 'in_transit', date_updated = NOW() WHERE kit_id = ANY($2::int[])`,
        [shipmentId, data.kitIds]);
    }
    await client.query('COMMIT');
    const row = sr.rows[0];
    return {
      shipmentId: row.shipmentId, studyId: row.studyId, shipmentNumber: row.shipmentNumber,
      shipmentType: row.shipmentType, sourceType: row.sourceType, sourceName: row.sourceName,
      destinationType: row.destinationType, destinationId: row.destinationId,
      destinationName: row.destinationName, status: row.status, trackingNumber: row.trackingNumber,
      expectedDelivery: row.expectedDelivery, requestedBy: row.requestedBy,
      requestedAt: row.requestedAt, dateCreated: row.dateCreated,
    };
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export async function getShipmentBeforeUpdate(shipmentId: number): Promise<{ status: string; shipmentNumber: string } | null> {
  const r = await pool.query('SELECT status, shipment_number FROM acc_shipment WHERE shipment_id = $1', [shipmentId]);
  return r.rows[0] ? { status: r.rows[0].status, shipmentNumber: r.rows[0].shipmentNumber } : null;
}

export async function markShipmentShipped(shipmentId: number, trackingNumber: string | undefined, userId: number): Promise<Record<string, unknown>> {
  const r = await pool.query(
    `UPDATE acc_shipment SET status = 'in_transit', tracking_number = COALESCE($2, tracking_number),
     shipped_at = NOW(), shipped_by = $3, date_updated = NOW() WHERE shipment_id = $1 RETURNING *`,
    [shipmentId, trackingNumber, userId]);
  return r.rows[0];
}

export async function confirmShipmentReceipt(shipmentId: number, receivedKitIds: number[] | undefined, notes: string | undefined, userId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE acc_shipment SET status = 'delivered', delivered_at = NOW(), received_by = $2, receipt_notes = $3, date_updated = NOW() WHERE shipment_id = $1`,
      [shipmentId, userId, notes]);
    if (receivedKitIds && receivedKitIds.length > 0) {
      const destR = await client.query('SELECT destination_id FROM acc_shipment WHERE shipment_id = $1', [shipmentId]);
      const siteId = destR.rows[0]?.destinationId;
      await client.query(
        `UPDATE acc_kit SET status = 'available', current_site_id = $2, date_updated = NOW() WHERE kit_id = ANY($1::int[])`,
        [receivedKitIds, siteId]);
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

// ── Dispensing ───────────────────────────────────────────────────────────────

export async function dispenseKit(
  kitId: number, subjectId: number, visitId: number, notes: string | undefined, userId: number
): Promise<{ kit: Record<string, unknown>; dispensingId: number; oldStatus: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM acc_kit WHERE kit_id = $1', [kitId]);
    const oldStatus = before.rows[0]?.status || 'available';
    const kr = await client.query(
      `UPDATE acc_kit SET status = 'dispensed', dispensed_to_subject_id = $2, date_updated = NOW()
       WHERE kit_id = $1 AND status IN ('available', 'reserved') RETURNING *`, [kitId, subjectId]);
    if (kr.rows.length === 0) { await client.query('ROLLBACK'); return null; }
    const dr = await client.query(
      `INSERT INTO acc_kit_dispensing (kit_id, study_subject_id, study_event_id, dispensed_by, dispensed_at, notes, date_created)
       VALUES ($1, $2, $3, $4, NOW(), $5, NOW()) RETURNING dispensing_id`,
      [kitId, subjectId, visitId, userId, notes]);
    await client.query('COMMIT');
    return { kit: kr.rows[0], dispensingId: dr.rows[0].dispensingId, oldStatus };
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export async function listDispensations(filters: {
  studyId?: number; siteId?: number; subjectId?: number; limit?: number;
}): Promise<DispensationRow[]> {
  let q = `SELECT d.*, k.kit_number, kt.name as kit_type_name, ss.label as subject_label,
    ua.user_name as dispensed_by_name
    FROM acc_kit_dispensing d LEFT JOIN acc_kit k ON d.kit_id = k.kit_id
    LEFT JOIN acc_kit_type kt ON k.kit_type_id = kt.kit_type_id
    LEFT JOIN study_subject ss ON d.study_subject_id = ss.study_subject_id
    LEFT JOIN user_account ua ON d.dispensed_by = ua.user_id WHERE 1=1`;
  const p: unknown[] = [];
  if (filters.studyId) { p.push(filters.studyId); q += ` AND kt.study_id = $${p.length}`; }
  if (filters.siteId) { p.push(filters.siteId); q += ` AND k.current_site_id = $${p.length}`; }
  if (filters.subjectId) { p.push(filters.subjectId); q += ` AND d.study_subject_id = $${p.length}`; }
  p.push(filters.limit || 50);
  q += ` ORDER BY d.dispensed_at DESC LIMIT $${p.length}`;
  const r = await pool.query(q, p);
  return r.rows.map((row: Record<string, unknown>) => ({
    dispensingId: row.dispensingId as number, kitId: row.kitId as number,
    kitNumber: (row.kitNumber ?? null) as string | null,
    kitTypeName: (row.kitTypeName ?? null) as string | null,
    studySubjectId: row.studySubjectId as number,
    subjectLabel: (row.subjectLabel ?? null) as string | null,
    dispensedByName: (row.dispensedByName ?? null) as string | null,
    dispensedAt: row.dispensedAt as string,
    quantityDispensed: (row.quantityDispensed ?? null) as number | null,
    notes: (row.notes ?? null) as string | null,
  }));
}

// ── Temperature ──────────────────────────────────────────────────────────────

export async function logTemperature(data: {
  siteId: number; storageUnit?: string; temperature: number; humidity?: number;
  notes?: string; deviceId?: string;
}, userId: number): Promise<{ logId: number; temperature: number; humidity: number | null; isExcursion: boolean; recordedAt: string }> {
  const isExcursion = data.temperature < 2 || data.temperature > 8;
  const r = await pool.query(
    `INSERT INTO acc_temperature_log (entity_type, entity_id, recorded_at, temperature, humidity,
      is_excursion, recorded_by, device_id, notes, date_created)
     VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
    ['site_storage', data.siteId, data.temperature, data.humidity,
     isExcursion, userId, data.deviceId || data.storageUnit,
     data.notes ? `${data.storageUnit}: ${data.notes}` : data.storageUnit]);
  const row = r.rows[0];
  return { logId: row.logId, temperature: row.temperature, humidity: row.humidity, isExcursion: row.isExcursion, recordedAt: row.recordedAt };
}

export async function getTemperatureLogs(siteId?: number, days: number = 7): Promise<{ readings: TempReading[]; excursionCount: number }> {
  const p: unknown[] = [days];
  let q = `SELECT log_id, entity_type, entity_id, recorded_at, temperature, humidity,
    is_excursion, excursion_duration_minutes, recorded_by, device_id, notes, date_created
    FROM acc_temperature_log WHERE recorded_at >= NOW() - make_interval(days => $1) AND entity_type = 'site_storage'`;
  if (siteId) { p.push(siteId); q += ` AND entity_id = $${p.length}`; }
  q += ' ORDER BY recorded_at DESC';
  const r = await pool.query(q, p);
  const excursionCount = r.rows.filter((row: Record<string, unknown>) => row.isExcursion === true).length;
  return {
    readings: r.rows.map((row: Record<string, unknown>) => ({
      logId: row.logId as number, siteId: row.entityId as number,
      temperature: parseFloat(String(row.temperature)), humidity: row.humidity ? parseFloat(String(row.humidity)) : null,
      isExcursion: row.isExcursion as boolean, recordedAt: row.recordedAt as string,
      deviceId: (row.deviceId ?? null) as string | null, notes: (row.notes ?? null) as string | null,
    })),
    excursionCount,
  };
}

// ── Alerts ───────────────────────────────────────────────────────────────────

const ALERT_BASE_QUERY = `SELECT a.*, s.name as study_name, site.name as site_name,
  kt.name as kit_type_name,
  CONCAT(ack_user.first_name, ' ', ack_user.last_name) as acknowledged_by_name,
  CONCAT(res_user.first_name, ' ', res_user.last_name) as resolved_by_name
  FROM acc_inventory_alert a
  LEFT JOIN study s ON a.study_id = s.study_id
  LEFT JOIN study site ON a.site_id = site.study_id
  LEFT JOIN acc_kit_type kt ON a.kit_type_id = kt.kit_type_id
  LEFT JOIN user_account ack_user ON a.acknowledged_by = ack_user.user_id
  LEFT JOIN user_account res_user ON a.resolved_by = res_user.user_id`;

function mapAlertRow(row: Record<string, unknown>): AlertRow {
  return {
    alertId: row.alertId as number, studyId: row.studyId as number,
    studyName: (row.studyName ?? null) as string | null,
    siteId: (row.siteId ?? null) as number | null,
    siteName: (row.siteName ?? null) as string | null,
    kitTypeId: (row.kitTypeId ?? null) as number | null,
    kitTypeName: (row.kitTypeName ?? null) as string | null,
    alertType: row.alertType as string, severity: row.severity as string,
    message: row.message as string,
    thresholdValue: (row.thresholdValue ?? null) as number | null,
    currentValue: (row.currentValue ?? null) as number | null,
    status: row.status as string,
    acknowledgedAt: (row.acknowledgedAt ?? null) as string | null,
    acknowledgedBy: (row.acknowledgedBy ?? null) as number | null,
    acknowledgedByName: (row.acknowledgedByName ?? null) as string | null,
    resolvedAt: (row.resolvedAt ?? null) as string | null,
    resolvedBy: (row.resolvedBy ?? null) as number | null,
    resolvedByName: (row.resolvedByName ?? null) as string | null,
    dateCreated: row.dateCreated as string,
  };
}

export async function listAlerts(filters: {
  studyId?: number; siteId?: number; status?: string; alertType?: string; severity?: string;
}): Promise<AlertRow[]> {
  let q = ALERT_BASE_QUERY + ' WHERE 1=1';
  const p: unknown[] = [];
  if (filters.studyId) { p.push(filters.studyId); q += ` AND a.study_id = $${p.length}`; }
  if (filters.siteId) { p.push(filters.siteId); q += ` AND a.site_id = $${p.length}`; }
  if (filters.status) { p.push(filters.status); q += ` AND a.status = $${p.length}`; }
  if (filters.alertType) { p.push(filters.alertType); q += ` AND a.alert_type = $${p.length}`; }
  if (filters.severity) { p.push(filters.severity); q += ` AND a.severity = $${p.length}`; }
  q += ' ORDER BY a.date_created DESC';
  const r = await pool.query(q, p);
  return r.rows.map(mapAlertRow);
}

export async function getAlertSummary(studyId?: number, siteId?: number): Promise<AlertSummary> {
  let wh = 'WHERE 1=1';
  const p: unknown[] = [];
  if (studyId) { p.push(studyId); wh += ` AND study_id = $${p.length}`; }
  if (siteId) { p.push(siteId); wh += ` AND site_id = $${p.length}`; }
  const r = await pool.query(`SELECT
    COUNT(*) FILTER (WHERE status = 'open') as open_count,
    COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged_count,
    COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
    COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical') as critical_count,
    COUNT(*) FILTER (WHERE status = 'open' AND severity = 'warning') as warning_count,
    COUNT(*) FILTER (WHERE alert_type = 'low_stock' AND status = 'open') as low_stock_count,
    COUNT(*) FILTER (WHERE alert_type = 'expiring_soon' AND status = 'open') as expiring_count,
    COUNT(*) FILTER (WHERE alert_type = 'temperature_excursion' AND status = 'open') as temp_excursion_count
    FROM acc_inventory_alert ${wh}`, p);
  const s = r.rows[0] || {};
  return {
    open: parseInt(s.openCount || 0), acknowledged: parseInt(s.acknowledgedCount || 0),
    resolved: parseInt(s.resolvedCount || 0),
    bySeverity: { critical: parseInt(s.criticalCount || 0), warning: parseInt(s.warningCount || 0) },
    byType: { lowStock: parseInt(s.lowStockCount || 0), expiringSoon: parseInt(s.expiringCount || 0),
      temperatureExcursion: parseInt(s.tempExcursionCount || 0) },
  };
}

export async function getAlertById(alertId: number): Promise<AlertRow | null> {
  const r = await pool.query(ALERT_BASE_QUERY + ' WHERE a.alert_id = $1', [alertId]);
  return r.rows.length ? mapAlertRow(r.rows[0]) : null;
}

export async function createAlert(data: {
  studyId: number; siteId?: number; kitTypeId?: number; alertType: string;
  severity?: string; message: string; thresholdValue?: number; currentValue?: number;
}): Promise<{ alertId: number; alertType: string; severity: string; status: string }> {
  const r = await pool.query(
    `INSERT INTO acc_inventory_alert (study_id, site_id, kit_type_id, alert_type, severity,
      message, threshold_value, current_value, status, date_created)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', NOW()) RETURNING *`,
    [data.studyId, data.siteId || null, data.kitTypeId || null, data.alertType,
     data.severity || 'warning', data.message, data.thresholdValue || null, data.currentValue || null]);
  const row = r.rows[0];
  return { alertId: row.alertId, alertType: row.alertType, severity: row.severity, status: row.status };
}

export async function getAlertStatus(alertId: number): Promise<{ status: string; alertType: string } | null> {
  const r = await pool.query('SELECT status, alert_type FROM acc_inventory_alert WHERE alert_id = $1', [alertId]);
  return r.rows.length ? { status: r.rows[0].status, alertType: r.rows[0].alertType } : null;
}

export async function acknowledgeAlert(alertId: number, userId: number): Promise<void> {
  await pool.query(
    `UPDATE acc_inventory_alert SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2 WHERE alert_id = $1`,
    [alertId, userId]);
}

export async function resolveAlert(alertId: number, userId: number): Promise<void> {
  await pool.query(
    `UPDATE acc_inventory_alert SET status = 'resolved', resolved_at = NOW(), resolved_by = $2 WHERE alert_id = $1`,
    [alertId, userId]);
}

// ── Inventory Checks ─────────────────────────────────────────────────────────

export async function checkInventoryLevels(studyId: number): Promise<CreatedAlert[]> {
  const ir = await pool.query(
    `SELECT kt.kit_type_id, kt.name as kit_type_name, kt.reorder_threshold,
      k.current_site_id as site_id, site.name as site_name,
      COUNT(k.kit_id) FILTER (WHERE k.status = 'available') as available_count
     FROM acc_kit_type kt LEFT JOIN acc_kit k ON kt.kit_type_id = k.kit_type_id
     LEFT JOIN study site ON k.current_site_id = site.study_id
     WHERE kt.study_id = $1 AND kt.reorder_threshold IS NOT NULL
     GROUP BY kt.kit_type_id, kt.name, kt.reorder_threshold, k.current_site_id, site.name
     HAVING COUNT(k.kit_id) FILTER (WHERE k.status = 'available') < kt.reorder_threshold`, [studyId]);

  const created: CreatedAlert[] = [];
  for (const row of ir.rows) {
    const existing = await pool.query(
      `SELECT alert_id FROM acc_inventory_alert WHERE study_id = $1
        AND COALESCE(site_id, 0) = COALESCE($2, 0) AND kit_type_id = $3
        AND alert_type = 'low_stock' AND status IN ('open', 'acknowledged')`,
      [studyId, row.siteId, row.kitTypeId]);
    if (existing.rows.length === 0) {
      const siteName = row.siteName || 'Depot';
      const avail = parseInt(row.availableCount);
      const r = await pool.query(
        `INSERT INTO acc_inventory_alert (study_id, site_id, kit_type_id, alert_type, severity,
          message, threshold_value, current_value, status, date_created)
         VALUES ($1, $2, $3, 'low_stock', $4, $5, $6, $7, 'open', NOW()) RETURNING alert_id`,
        [studyId, row.siteId, row.kitTypeId, avail === 0 ? 'critical' : 'warning',
         `Low stock: ${row.kitTypeName} at ${siteName} (${avail} available, threshold: ${row.reorderThreshold})`,
         row.reorderThreshold, avail]);
      created.push({ alertId: r.rows[0].alertId, kitType: row.kitTypeName, site: siteName,
        available: avail, threshold: row.reorderThreshold });
    }
  }
  return created;
}

export async function checkExpiringKits(studyId: number, daysAhead: number = 30): Promise<CreatedAlert[]> {
  const er = await pool.query(
    `SELECT kt.kit_type_id, kt.name as kit_type_name, k.current_site_id as site_id,
      site.name as site_name, COUNT(k.kit_id) as expiring_count, MIN(k.expiration_date) as earliest_expiry
     FROM acc_kit k JOIN acc_kit_type kt ON k.kit_type_id = kt.kit_type_id
     LEFT JOIN study site ON k.current_site_id = site.study_id
     WHERE kt.study_id = $1 AND k.status = 'available' AND k.expiration_date <= NOW() + make_interval(days => $2)
     GROUP BY kt.kit_type_id, kt.name, k.current_site_id, site.name`, [studyId, daysAhead]);

  const created: CreatedAlert[] = [];
  for (const row of er.rows) {
    const existing = await pool.query(
      `SELECT alert_id FROM acc_inventory_alert WHERE study_id = $1
        AND COALESCE(site_id, 0) = COALESCE($2, 0) AND kit_type_id = $3
        AND alert_type = 'expiring_soon' AND status IN ('open', 'acknowledged')`,
      [studyId, row.siteId, row.kitTypeId]);
    if (existing.rows.length === 0) {
      const siteName = row.siteName || 'Depot';
      const cnt = parseInt(row.expiringCount);
      const daysUntil = Math.ceil((new Date(row.earliestExpiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const r = await pool.query(
        `INSERT INTO acc_inventory_alert (study_id, site_id, kit_type_id, alert_type, severity,
          message, current_value, status, date_created)
         VALUES ($1, $2, $3, 'expiring_soon', $4, $5, $6, 'open', NOW()) RETURNING alert_id`,
        [studyId, row.siteId, row.kitTypeId, daysUntil <= 7 ? 'critical' : 'warning',
         `Expiring kits: ${cnt} ${row.kitTypeName} kits at ${siteName} expire within ${daysAhead} days (earliest: ${row.earliestExpiry})`,
         cnt]);
      created.push({ alertId: r.rows[0].alertId, kitType: row.kitTypeName, site: siteName,
        count: cnt, earliestExpiry: row.earliestExpiry });
    }
  }
  return created;
}

