import { Request, Response } from 'express';
import { asyncHandler, BadRequestError, NotFoundError } from '../middleware/errorHandler.middleware';
import * as rtsmService from '../services/database/rtsm.service';
import type { Part11Request } from '../middleware/part11.middleware';
import { Part11EventTypes, recordPart11Audit, formatPart11Timestamp } from '../middleware/part11.middleware';
import type { ApiResponse } from '@accura-trial/shared-types';

const uid = (req: Request) => (req as any).user?.userId as number;
const uname = (req: Request) => (req as any).user?.userName as string;

// ── Dashboard ────────────────────────────────────────────────────────────────

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const studyId = req.query.studyId ? parseInt(req.query.studyId as string) : undefined;
  const siteId = req.query.siteId ? parseInt(req.query.siteId as string) : undefined;
  const data = await rtsmService.getDashboard(studyId, siteId);
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

// ── Kit Types ────────────────────────────────────────────────────────────────

export const listKitTypes = asyncHandler(async (req: Request, res: Response) => {
  const studyId = req.query.studyId ? parseInt(req.query.studyId as string) : undefined;
  const data = await rtsmService.listKitTypes(studyId);
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

// ── Kits ─────────────────────────────────────────────────────────────────────

export const listKits = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, siteId, status, kitTypeId, search } = req.query;
  const data = await rtsmService.listKits({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    siteId: siteId ? parseInt(siteId as string) : undefined,
    status: status as string | undefined,
    kitTypeId: kitTypeId ? parseInt(kitTypeId as string) : undefined,
    search: search as string | undefined,
  });
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

export const registerKits = asyncHandler(async (req: Part11Request, res: Response) => {
  const { studyId, kitTypeId, kits } = req.body;
  const userId = uid(req); const userName = uname(req);
  const result = await rtsmService.registerKits(kitTypeId, kits, userId);

  for (const d of result.details) {
    await recordPart11Audit(userId, userName, Part11EventTypes.KIT_REGISTERED,
      'acc_kit', d.kitId, d.kitNumber, null,
      { kitNumber: d.kitNumber, kitTypeId, lotNumber: d.lotNumber, expirationDate: d.expirationDate, status: 'available' },
      'Kit registered in inventory', { ipAddress: req.ip });
  }

  const response: ApiResponse<typeof result.inserted> = {
    success: true, data: result.inserted, message: `${result.inserted.length} kits registered successfully`,
  };
  res.json(response);
});

export const reserveKit = asyncHandler(async (req: Request, res: Response) => {
  const kitId = parseInt(req.params.id);
  const { subjectId } = req.body;
  const row = await rtsmService.reserveKit(kitId, subjectId);
  if (!row) throw new BadRequestError('Kit not available for reservation');
  const data = {
    kitId: row.kitId, kitTypeId: row.kitTypeId, kitNumber: row.kitNumber, status: row.status,
    dispensedToSubjectId: row.dispensedToSubjectId, currentSiteId: row.currentSiteId,
    lotNumber: row.lotNumber, expirationDate: row.expirationDate, dateUpdated: row.dateUpdated,
  };
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

// ── Shipments ────────────────────────────────────────────────────────────────

export const listShipments = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, siteId, status } = req.query;
  const data = await rtsmService.listShipments({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    siteId: siteId ? parseInt(siteId as string) : undefined,
    status: status as string | undefined,
  });
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

export const createShipment = asyncHandler(async (req: Part11Request, res: Response) => {
  const { studyId, destinationSiteId, kitIds, expectedDeliveryDate, trackingNumber } = req.body;
  const userId = uid(req); const userName = uname(req);
  const shipment = await rtsmService.createShipment(
    { studyId, destinationSiteId, kitIds, trackingNumber, expectedDeliveryDate }, userId);

  await recordPart11Audit(userId, userName, Part11EventTypes.SHIPMENT_CREATED,
    'acc_shipment', shipment.shipmentId, shipment.shipmentNumber, null,
    { shipmentNumber: shipment.shipmentNumber, studyId, destinationSiteId,
      kitCount: kitIds?.length || 0, kitIds: kitIds || [], expectedDeliveryDate, status: 'pending' },
    'Shipment created for kit distribution', { ipAddress: req.ip });

  const response: ApiResponse<typeof shipment> = { success: true, data: shipment };
  res.json(response);
});

export const markShipmentShipped = asyncHandler(async (req: Part11Request, res: Response) => {
  const shipmentId = parseInt(req.params.id);
  const { trackingNumber } = req.body;
  const userId = uid(req); const userName = uname(req);

  const before = await rtsmService.getShipmentBeforeUpdate(shipmentId);
  const row = await rtsmService.markShipmentShipped(shipmentId, trackingNumber, userId);

  await recordPart11Audit(userId, userName,
    Part11EventTypes.SHIPMENT_CREATED || 'SHIPMENT_SHIPPED',
    'acc_shipment', shipmentId, before?.shipmentNumber ?? '',
    { status: before?.status }, { status: 'in_transit', trackingNumber, shippedAt: formatPart11Timestamp() },
    'Shipment marked as shipped', { ipAddress: req.ip });

  const data = {
    shipmentId: row.shipmentId, shipmentNumber: row.shipmentNumber, status: row.status,
    trackingNumber: row.trackingNumber, shippedAt: row.shippedAt,
    shippedBy: row.shippedBy, dateUpdated: row.dateUpdated,
  };
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

export const confirmShipmentReceipt = asyncHandler(async (req: Part11Request, res: Response) => {
  const shipmentId = parseInt(req.params.id);
  const { receivedKitIds, notes } = req.body;
  const userId = uid(req); const userName = uname(req);

  const before = await rtsmService.getShipmentBeforeUpdate(shipmentId);
  await rtsmService.confirmShipmentReceipt(shipmentId, receivedKitIds, notes, userId);

  await recordPart11Audit(userId, userName, Part11EventTypes.SHIPMENT_RECEIVED,
    'acc_shipment', shipmentId, before?.shipmentNumber ?? '',
    { status: before?.status },
    { status: 'confirmed', receivedKitCount: receivedKitIds?.length || 0,
      receivedKitIds: receivedKitIds || [], receivedAt: formatPart11Timestamp(), notes },
    'Shipment receipt confirmed', { ipAddress: req.ip });

  const response: ApiResponse = { success: true, message: 'Shipment receipt confirmed' };
  res.json(response);
});

// ── Dispensing ───────────────────────────────────────────────────────────────

export const dispenseKit = asyncHandler(async (req: Part11Request, res: Response) => {
  const { kitId, subjectId, visitId, notes } = req.body;
  const userId = uid(req); const userName = uname(req);
  const result = await rtsmService.dispenseKit(kitId, subjectId, visitId, notes, userId);
  if (!result) throw new BadRequestError('Kit not available for dispensing');

  const kit = result.kit as Record<string, unknown>;
  await recordPart11Audit(userId, userName, Part11EventTypes.KIT_DISPENSED,
    'acc_kit_dispensing', result.dispensingId, kit.kitNumber as string,
    { status: result.oldStatus },
    { kitId, kitNumber: kit.kitNumber, subjectId, visitId, status: 'dispensed',
      dispensedAt: formatPart11Timestamp(), electronicSignature: true,
      signatureMeaning: req.body.signatureMeaning || 'Authorized dispensing of investigational product' },
    'Kit dispensed to subject with electronic signature verification',
    { ipAddress: req.ip, signatureMeaning: req.body.signatureMeaning });

  const data = {
    kitId: kit.kitId, kitTypeId: kit.kitTypeId, kitNumber: kit.kitNumber, status: kit.status,
    dispensedToSubjectId: kit.dispensedToSubjectId, currentSiteId: kit.currentSiteId,
    lotNumber: kit.lotNumber, expirationDate: kit.expirationDate, dateUpdated: kit.dateUpdated,
  };
  const response: ApiResponse<typeof data> = {
    success: true, data, message: 'Kit dispensed successfully with electronic signature',
  };
  res.json(response);
});

export const listDispensations = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, siteId, subjectId, limit } = req.query;
  const data = await rtsmService.listDispensations({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    siteId: siteId ? parseInt(siteId as string) : undefined,
    subjectId: subjectId ? parseInt(subjectId as string) : undefined,
    limit: limit ? parseInt(limit as string) : 50,
  });
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

// ── Temperature ──────────────────────────────────────────────────────────────

export const logTemperature = asyncHandler(async (req: Request, res: Response) => {
  const { siteId, storageUnit, temperature, humidity, notes, deviceId } = req.body;
  const userId = (req as any).user?.userId as number;
  const data = await rtsmService.logTemperature(
    { siteId, storageUnit, temperature, humidity, notes, deviceId }, userId);
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

export const getTemperatureLogs = asyncHandler(async (req: Request, res: Response) => {
  const siteId = req.query.siteId ? parseInt(req.query.siteId as string) : undefined;
  const days = parseInt(String(req.query.days)) || 7;
  const data = await rtsmService.getTemperatureLogs(siteId, days);
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

// ── Alerts ───────────────────────────────────────────────────────────────────

export const listAlerts = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, siteId, status, alertType, severity } = req.query;
  const data = await rtsmService.listAlerts({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    siteId: siteId ? parseInt(siteId as string) : undefined,
    status: status as string | undefined, alertType: alertType as string | undefined,
    severity: severity as string | undefined,
  });
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

export const getAlertSummary = asyncHandler(async (req: Request, res: Response) => {
  const studyId = req.query.studyId ? parseInt(req.query.studyId as string) : undefined;
  const siteId = req.query.siteId ? parseInt(req.query.siteId as string) : undefined;
  const data = await rtsmService.getAlertSummary(studyId, siteId);
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

export const getAlertById = asyncHandler(async (req: Request, res: Response) => {
  const data = await rtsmService.getAlertById(parseInt(req.params.id));
  if (!data) throw new NotFoundError('Alert not found');
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

export const createAlert = asyncHandler(async (req: Part11Request, res: Response) => {
  const { studyId, siteId, kitTypeId, alertType, severity, message, thresholdValue, currentValue } = req.body;
  if (!studyId || !alertType || !message) throw new BadRequestError('studyId, alertType, and message are required');
  const userId = uid(req); const userName = uname(req);
  const data = await rtsmService.createAlert({ studyId, siteId, kitTypeId, alertType, severity, message, thresholdValue, currentValue });

  await recordPart11Audit(userId, userName,
    Part11EventTypes.INVENTORY_ALERT_CREATED || 'INVENTORY_ALERT_CREATED',
    'acc_inventory_alert', data.alertId, `${alertType} alert`, null,
    { studyId, siteId, kitTypeId, alertType, severity: severity || 'warning', message },
    'Inventory alert created', { ipAddress: req.ip });

  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

export const acknowledgeAlert = asyncHandler(async (req: Part11Request, res: Response) => {
  const alertId = parseInt(req.params.id);
  const userId = uid(req); const userName = uname(req);
  const current = await rtsmService.getAlertStatus(alertId);
  if (!current) throw new NotFoundError('Alert not found');
  if (current.status !== 'open') throw new BadRequestError(`Cannot acknowledge alert with status: ${current.status}`);

  await rtsmService.acknowledgeAlert(alertId, userId);

  await recordPart11Audit(userId, userName,
    Part11EventTypes.INVENTORY_ALERT_ACKNOWLEDGED || 'INVENTORY_ALERT_ACKNOWLEDGED',
    'acc_inventory_alert', alertId, `${current.alertType} alert ${alertId}`,
    { status: current.status }, { status: 'acknowledged' },
    'Inventory alert acknowledged', { ipAddress: req.ip });

  const response: ApiResponse = { success: true, message: 'Alert acknowledged successfully' };
  res.json(response);
});

export const resolveAlert = asyncHandler(async (req: Part11Request, res: Response) => {
  const alertId = parseInt(req.params.id);
  const { notes } = req.body;
  const userId = uid(req); const userName = uname(req);
  const current = await rtsmService.getAlertStatus(alertId);
  if (!current) throw new NotFoundError('Alert not found');
  if (current.status === 'resolved') throw new BadRequestError('Alert is already resolved');

  await rtsmService.resolveAlert(alertId, userId);

  await recordPart11Audit(userId, userName,
    Part11EventTypes.INVENTORY_ALERT_RESOLVED || 'INVENTORY_ALERT_RESOLVED',
    'acc_inventory_alert', alertId, `${current.alertType} alert ${alertId}`,
    { status: current.status }, { status: 'resolved', notes },
    'Inventory alert resolved', { ipAddress: req.ip });

  const response: ApiResponse = { success: true, message: 'Alert resolved successfully' };
  res.json(response);
});

// ── Inventory Checks ─────────────────────────────────────────────────────────

export const checkInventory = asyncHandler(async (req: Part11Request, res: Response) => {
  const { studyId } = req.body;
  if (!studyId) throw new BadRequestError('studyId is required');
  const userId = uid(req); const userName = uname(req);
  const alerts = await rtsmService.checkInventoryLevels(studyId);

  for (const a of alerts) {
    await recordPart11Audit(userId, userName,
      Part11EventTypes.INVENTORY_ALERT_CREATED || 'INVENTORY_ALERT_CREATED',
      'acc_inventory_alert', a.alertId, 'low_stock alert', null,
      { kitTypeId: a.kitType, available: a.available, threshold: a.threshold },
      'Low stock alert auto-generated', { ipAddress: req.ip });
  }

  const response: ApiResponse<{ alerts: typeof alerts }> = {
    success: true, data: { alerts }, message: `${alerts.length} low stock alerts created`,
  };
  res.json(response);
});

export const checkExpiry = asyncHandler(async (req: Part11Request, res: Response) => {
  const { studyId, daysAhead = 30 } = req.body;
  if (!studyId) throw new BadRequestError('studyId is required');
  const userId = uid(req); const userName = uname(req);
  const alerts = await rtsmService.checkExpiringKits(studyId, parseInt(String(daysAhead)) || 30);

  for (const a of alerts) {
    await recordPart11Audit(userId, userName,
      Part11EventTypes.INVENTORY_ALERT_CREATED || 'INVENTORY_ALERT_CREATED',
      'acc_inventory_alert', a.alertId, 'expiring_soon alert', null,
      { kitTypeId: a.kitType, count: a.count, earliestExpiry: a.earliestExpiry },
      'Expiring kits alert auto-generated', { ipAddress: req.ip });
  }

  const response: ApiResponse<{ alerts: typeof alerts }> = {
    success: true, data: { alerts }, message: `${alerts.length} expiry alerts created`,
  };
  res.json(response);
});

