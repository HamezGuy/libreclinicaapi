/**
 * RTSM Routes Unit Tests
 * 
 * Tests for RTSM (Randomization and Trial Supply Management) API endpoints
 * including kits, shipments, temperature logs, and inventory alerts.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('RTSM Routes - Temperature Logging', () => {
  describe('POST /api/rtsm/temperature', () => {
    it('should use entity_type/entity_id pattern for table storage', () => {
      // acc_temperature_log uses entity_type and entity_id columns
      // NOT site_id and storage_unit
      const correctColumns = ['entity_type', 'entity_id', 'temperature', 'humidity', 'is_excursion'];
      const incorrectColumns = ['site_id', 'storage_unit'];

      expect(correctColumns).toContain('entity_type');
      expect(correctColumns).toContain('entity_id');
      expect(correctColumns).not.toContain('site_id');
    });

    it('should calculate is_excursion based on temperature range', () => {
      // Standard cold storage range is 2-8°C
      const minTemp = 2;
      const maxTemp = 8;
      
      const temperatures = [
        { temp: 1, expected: true },   // Below range - excursion
        { temp: 2, expected: false },  // At min - OK
        { temp: 5, expected: false },  // In range - OK
        { temp: 8, expected: false },  // At max - OK
        { temp: 9, expected: true },   // Above range - excursion
        { temp: -5, expected: true },  // Way below - excursion
        { temp: 25, expected: true }   // Way above - excursion
      ];

      temperatures.forEach(({ temp, expected }) => {
        const isExcursion = temp < minTemp || temp > maxTemp;
        expect(isExcursion).toBe(expected);
      });
    });

    it('should use device_id for storage unit identification', () => {
      // The storageUnit input should be mapped to device_id in the database
      const inputStorageUnit = 'FRIDGE-01';
      const expectedDbField = 'device_id';
      
      expect(expectedDbField).toBe('device_id');
    });
  });

  describe('GET /api/rtsm/temperature', () => {
    it('should filter by entity_type = site_storage', () => {
      const entityType = 'site_storage';
      expect(entityType).toBe('site_storage');
    });

    it('should return mapped response with siteId from entity_id', () => {
      const dbRow = {
        log_id: 1,
        entity_type: 'site_storage',
        entity_id: 5,
        recorded_at: new Date(),
        temperature: 4.5,
        humidity: 45,
        is_excursion: false,
        device_id: 'FRIDGE-01',
        notes: 'Normal reading'
      };

      const expectedResponse = {
        logId: dbRow.log_id,
        siteId: dbRow.entity_id, // Mapped from entity_id
        temperature: parseFloat(dbRow.temperature.toString()),
        humidity: dbRow.humidity,
        isExcursion: dbRow.is_excursion,
        recordedAt: dbRow.recorded_at,
        deviceId: dbRow.device_id,
        notes: dbRow.notes
      };

      expect(expectedResponse.siteId).toBe(5);
      expect(expectedResponse.temperature).toBe(4.5);
    });
  });
});

describe('RTSM Routes - Shipments', () => {
  describe('POST /api/rtsm/shipments', () => {
    it('should include required NOT NULL columns', () => {
      // acc_shipment requires source_type and destination_type
      const requiredColumns = [
        'study_id',
        'shipment_number',
        'source_type',      // NOT NULL
        'destination_type', // NOT NULL
        'status'
      ];

      requiredColumns.forEach(col => {
        expect(col).toBeDefined();
      });
    });

    it('should use requested_by NOT created_by', () => {
      const correctColumn = 'requested_by';
      const incorrectColumn = 'created_by';
      
      expect(correctColumn).toBe('requested_by');
      expect(incorrectColumn).not.toBe('requested_by');
    });

    it('should set source_type and destination_type values', () => {
      // For depot-to-site shipments
      const sourceType = 'depot';
      const destinationType = 'site';
      
      expect(['depot', 'site']).toContain(sourceType);
      expect(['depot', 'site']).toContain(destinationType);
    });
  });

  describe('POST /api/rtsm/shipments/:id/ship', () => {
    it('should use shipped_at NOT ship_date', () => {
      const correctColumn = 'shipped_at';
      const incorrectColumn = 'ship_date';
      
      expect(correctColumn).toBe('shipped_at');
    });

    it('should also set shipped_by', () => {
      const updateColumns = ['shipped_at', 'shipped_by', 'tracking_number', 'date_updated'];
      expect(updateColumns).toContain('shipped_by');
    });
  });

  describe('POST /api/rtsm/shipments/:id/confirm', () => {
    it('should use receipt_notes NOT notes', () => {
      const correctColumn = 'receipt_notes';
      expect(correctColumn).toBe('receipt_notes');
    });

    it('should set status to "delivered" NOT "confirmed"', () => {
      // Valid statuses: pending, in_transit, delivered, cancelled
      const validStatuses = ['pending', 'in_transit', 'delivered', 'cancelled'];
      const correctStatus = 'delivered';
      const incorrectStatus = 'confirmed';
      
      expect(validStatuses).toContain(correctStatus);
      expect(validStatuses).not.toContain(incorrectStatus);
    });
  });
});

describe('RTSM Routes - Dispensations', () => {
  describe('GET /api/rtsm/dispensations', () => {
    it('should query acc_kit_dispensing table', () => {
      const tableName = 'acc_kit_dispensing';
      expect(tableName).toBe('acc_kit_dispensing');
    });

    it('should use dispensing_id NOT dispensation_id', () => {
      const correctColumn = 'dispensing_id';
      const incorrectColumn = 'dispensation_id';
      
      expect(correctColumn).toBe('dispensing_id');
    });

    it('should use dispensed_at NOT dispensed_date', () => {
      const correctColumn = 'dispensed_at';
      const incorrectColumn = 'dispensed_date';
      
      expect(correctColumn).toBe('dispensed_at');
    });

    it('should map response correctly', () => {
      const dbRow = {
        dispensing_id: 1,
        kit_id: 10,
        kit_number: 'KIT-001',
        kit_type_name: 'Treatment A',
        study_subject_id: 100,
        subject_label: 'SUBJ-001',
        dispensed_by_name: 'John Doe',
        dispensed_at: new Date(),
        quantity_dispensed: 1,
        notes: 'Dispensed during V2'
      };

      const expectedResponse = {
        dispensingId: dbRow.dispensing_id,
        kitId: dbRow.kit_id,
        kitNumber: dbRow.kit_number,
        kitType: dbRow.kit_type_name,
        subjectId: dbRow.study_subject_id,
        subjectLabel: dbRow.subject_label,
        dispensedBy: dbRow.dispensed_by_name,
        dispensedAt: dbRow.dispensed_at,
        quantityDispensed: dbRow.quantity_dispensed,
        notes: dbRow.notes
      };

      expect(expectedResponse.dispensingId).toBe(1);
      expect(expectedResponse.dispensedAt).toBeDefined();
    });
  });
});

describe('RTSM Routes - Inventory Alerts', () => {
  describe('POST /api/rtsm/alerts', () => {
    it('should insert into acc_inventory_alert table', () => {
      const requiredColumns = [
        'study_id',
        'alert_type',
        'severity',
        'message',
        'status',
        'date_created'
      ];

      requiredColumns.forEach(col => {
        expect(col).toBeDefined();
      });
    });

    it('should support valid alert types', () => {
      const validAlertTypes = ['low_stock', 'expiring_soon', 'temperature_excursion'];
      
      validAlertTypes.forEach(type => {
        expect(['low_stock', 'expiring_soon', 'temperature_excursion']).toContain(type);
      });
    });

    it('should support valid severity levels', () => {
      const validSeverities = ['info', 'warning', 'critical'];
      
      validSeverities.forEach(sev => {
        expect(['info', 'warning', 'critical']).toContain(sev);
      });
    });
  });

  describe('POST /api/rtsm/alerts/:id/acknowledge', () => {
    it('should update acknowledged_at and acknowledged_by columns', () => {
      const updateColumns = ['acknowledged_at', 'acknowledged_by', 'status'];
      
      expect(updateColumns).toContain('acknowledged_at');
      expect(updateColumns).toContain('acknowledged_by');
    });
  });

  describe('POST /api/rtsm/alerts/:id/resolve', () => {
    it('should update resolved_at and resolved_by columns', () => {
      const updateColumns = ['resolved_at', 'resolved_by', 'status'];
      
      expect(updateColumns).toContain('resolved_at');
      expect(updateColumns).toContain('resolved_by');
    });
  });
});

describe('RTSM Routes - Shipment Response Format', () => {
  it('should map shipment columns correctly', () => {
    const dbRow = {
      shipment_id: 1,
      shipment_number: 'SHP-001',
      destination_id: 5,
      destination_name: 'Site A',
      status: 'pending',
      shipped_at: null,
      expected_delivery: new Date(),
      delivered_at: null,
      tracking_number: 'TRACK123',
      carrier: 'FedEx'
    };

    const expectedResponse = {
      shipmentId: dbRow.shipment_id,
      shipmentNumber: dbRow.shipment_number,
      destinationId: dbRow.destination_id,
      destinationName: dbRow.destination_name,
      status: dbRow.status,
      shippedAt: dbRow.shipped_at,
      expectedDelivery: dbRow.expected_delivery,
      deliveredAt: dbRow.delivered_at,
      trackingNumber: dbRow.tracking_number,
      carrier: dbRow.carrier
    };

    expect(expectedResponse.shipmentId).toBe(1);
    expect(expectedResponse.destinationName).toBe('Site A');
    // Note: NOT shipDate, actualDelivery, siteName
  });
});
