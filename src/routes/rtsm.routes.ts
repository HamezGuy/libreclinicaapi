/**
 * RTSM (Randomization and Trial Supply Management) Routes
 *
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail for all kit, shipment, and dispensing operations
 * - §11.10(k): UTC timestamps for all events
 * - §11.50: Electronic signature required for dispensing (GxP critical)
 */

import { Router } from 'express';
import Joi from 'joi';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { requireSignature } from '../middleware/part11.middleware';
import * as rtsmCtrl from '../controllers/rtsm.controller';

const router = Router();

// ── Validation Schemas ───────────────────────────────────────────────────────

const rtsmSchemas = {
  registerKits: Joi.object({
    studyId: Joi.number().integer().positive().required()
      .messages({ 'any.required': 'studyId is required' }),
    kitTypeId: Joi.number().integer().positive().required()
      .messages({ 'any.required': 'kitTypeId is required' }),
    kits: Joi.array().items(Joi.object({
      kitNumber: Joi.string().required().max(255)
        .messages({ 'any.required': 'kitNumber is required for each kit' }),
      lotNumber: Joi.string().optional().max(255).allow('', null),
      manufactureDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).optional().allow(null),
      manufacturingDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).optional().allow(null),
      expirationDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).optional().allow(null),
    })).min(1).required()
      .messages({ 'any.required': 'kits array is required', 'array.min': 'At least one kit is required' }),
  }),
};

// ── Middleware ────────────────────────────────────────────────────────────────

router.use(authMiddleware);

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', rtsmCtrl.getDashboard);

// ── Kit Types ────────────────────────────────────────────────────────────────

router.get('/kit-types', rtsmCtrl.listKitTypes);

// ── Kits ─────────────────────────────────────────────────────────────────────

router.get('/kits', rtsmCtrl.listKits);
router.post('/kits', validate({ body: rtsmSchemas.registerKits }), rtsmCtrl.registerKits);
router.post('/kits/:id/reserve', rtsmCtrl.reserveKit);

// ── Shipments ────────────────────────────────────────────────────────────────

router.get('/shipments', rtsmCtrl.listShipments);
router.post('/shipments', rtsmCtrl.createShipment);
router.post('/shipments/:id/ship', rtsmCtrl.markShipmentShipped);
router.post('/shipments/:id/confirm', rtsmCtrl.confirmShipmentReceipt);

// ── Dispensing ───────────────────────────────────────────────────────────────

router.post('/dispense', requireSignature, rtsmCtrl.dispenseKit);
router.get('/dispensations', rtsmCtrl.listDispensations);

// ── Temperature ──────────────────────────────────────────────────────────────

router.post('/temperature', rtsmCtrl.logTemperature);
router.get('/temperature', rtsmCtrl.getTemperatureLogs);

// ── Alerts ───────────────────────────────────────────────────────────────────

router.get('/alerts', rtsmCtrl.listAlerts);
router.get('/alerts/summary', rtsmCtrl.getAlertSummary);
router.get('/alerts/:id', rtsmCtrl.getAlertById);
router.post('/alerts', rtsmCtrl.createAlert);
router.post('/alerts/:id/acknowledge', rtsmCtrl.acknowledgeAlert);
router.post('/alerts/:id/resolve', rtsmCtrl.resolveAlert);
router.post('/alerts/check-inventory', rtsmCtrl.checkInventory);
router.post('/alerts/check-expiry', rtsmCtrl.checkExpiry);

export default router;
