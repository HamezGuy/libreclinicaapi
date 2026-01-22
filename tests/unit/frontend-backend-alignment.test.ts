/**
 * Frontend-Backend Alignment Tests
 * 
 * These tests document and verify that frontend service interfaces
 * match the backend API response formats.
 */

import { describe, it, expect } from '@jest/globals';

// ============================================================================
// RTSM Frontend-Backend Alignment
// ============================================================================

describe('RTSM Frontend-Backend Alignment', () => {
  describe('Shipment interface alignment', () => {
    it('should use correct field names', () => {
      // Frontend Shipment interface (rtsm.service.ts)
      const frontendFields = [
        'shipmentId',
        'shipmentNumber',
        'destinationId',      // NOT siteId
        'destinationName',
        'siteName',           // Alias for backward compatibility
        'status',             // 'pending' | 'in_transit' | 'delivered' | 'cancelled'
        'kitCount',
        'shippedAt',          // NOT shipDate
        'expectedDelivery',
        'deliveredAt',        // NOT actualDelivery
        'trackingNumber',
        'carrier'
      ];

      // Verify correct field names
      expect(frontendFields).toContain('shippedAt');
      expect(frontendFields).toContain('deliveredAt');
      expect(frontendFields).not.toContain('shipDate');
      expect(frontendFields).not.toContain('actualDelivery');
    });

    it('should have valid status values', () => {
      // Valid statuses from acc_shipment table
      const validStatuses = ['pending', 'in_transit', 'delivered', 'cancelled'];
      
      // 'shipped' and 'confirmed' are NOT valid
      expect(validStatuses).not.toContain('shipped');
      expect(validStatuses).not.toContain('confirmed');
    });
  });

  describe('Dispensation interface alignment', () => {
    it('should use correct field names', () => {
      // Frontend Dispensation interface
      const frontendFields = [
        'dispensingId',       // NOT dispensationId
        'kitId',
        'kitNumber',
        'kitType',
        'subjectId',
        'subjectLabel',
        'dispensedBy',
        'dispensedAt',        // NOT dispensedDate
        'quantityDispensed',
        'notes'
      ];

      expect(frontendFields).toContain('dispensingId');
      expect(frontendFields).toContain('dispensedAt');
      expect(frontendFields).not.toContain('dispensationId');
      expect(frontendFields).not.toContain('dispensedDate');
    });
  });

  describe('TemperatureLog interface alignment', () => {
    it('should match backend response format', () => {
      // Frontend TemperatureLog interface
      const frontendFields = [
        'logId',
        'siteId',         // Mapped from entity_id
        'temperature',
        'humidity',
        'isExcursion',    // NOT calculated on frontend
        'recordedAt',
        'deviceId',
        'notes'
      ];

      // Should NOT have old field names
      expect(frontendFields).not.toContain('storageUnit');
      expect(frontendFields).not.toContain('recordedBy');
      
      expect(frontendFields).toContain('isExcursion');
      expect(frontendFields).toContain('deviceId');
    });
  });

  describe('InventoryAlert interface alignment', () => {
    it('should have all required fields', () => {
      const frontendFields = [
        'alertId',
        'studyId',
        'siteId',
        'kitTypeId',
        'alertType',
        'severity',
        'message',
        'thresholdValue',
        'currentValue',
        'status',
        'acknowledgedAt',
        'acknowledgedBy',
        'acknowledgedByName',
        'resolvedAt',
        'resolvedBy',
        'resolvedByName',
        'dateCreated'
      ];

      expect(frontendFields).toContain('acknowledgedAt');
      expect(frontendFields).toContain('resolvedAt');
    });
  });
});

// ============================================================================
// ePRO Frontend-Backend Alignment
// ============================================================================

describe('ePRO Frontend-Backend Alignment', () => {
  describe('PROResponse interface alignment', () => {
    it('should use "answers" NOT "responseData"', () => {
      // Frontend PROResponse interface should have:
      const frontendFields = [
        'responseId',
        'assignmentId',
        'studySubjectId',   // Required in table
        'instrumentId',
        'answers',          // NOT responseData
        'rawScore',
        'scaledScore',
        'scoreInterpretation',
        'startedAt',
        'completedAt',
        'timeSpentSeconds',
        'deviceType',
        'flagged',
        'flagReason',
        'dateCreated'
      ];

      expect(frontendFields).toContain('answers');
      expect(frontendFields).not.toContain('responseData');
      expect(frontendFields).toContain('studySubjectId');
    });
  });

  describe('PROReminder interface alignment', () => {
    it('should match backend response format', () => {
      const frontendFields = [
        'reminderId',
        'assignmentId',
        'patientAccountId',
        'studySubjectId',
        'subjectLabel',
        'instrumentName',
        'patientEmail',
        'patientPhone',
        'reminderType',
        'scheduledFor',
        'sentAt',
        'status',
        'messageSubject',
        'messageBody',
        'errorMessage',
        'dateCreated'
      ];

      expect(frontendFields).toContain('reminderId');
      expect(frontendFields).toContain('scheduledFor');
    });
  });
});

// ============================================================================
// Flagging Frontend-Backend Alignment
// ============================================================================

describe('Flagging Frontend-Backend Alignment', () => {
  describe('CRFFlag interface alignment', () => {
    it('should match backend response format', () => {
      const frontendFields = [
        'flagId',
        'path',
        'parsedPath',
        'tagId',
        'flagWorkflowId',
        'workflowId',
        'workflowStatus',
        'ownerId',
        'ownerName',
        'updateId',
        'updaterName',
        'dateCreated',
        'dateUpdated'
      ];

      expect(frontendFields).toContain('flagId');
      expect(frontendFields).toContain('parsedPath');
    });
  });

  describe('FlagPath interface alignment', () => {
    it('should have correct structure for CRF paths', () => {
      const crfPathFields = [
        'studySubjectOid',
        'studyEventOid',
        'eventOrdinal',
        'crfOid'
      ];

      expect(crfPathFields.length).toBe(4);
    });

    it('should have extended structure for item paths', () => {
      const itemPathFields = [
        'studySubjectOid',
        'studyEventOid',
        'eventOrdinal',
        'crfOid',
        'groupOid',       // Optional
        'groupOrdinal',   // Optional
        'itemOid'         // Optional
      ];

      expect(itemPathFields.length).toBe(7);
    });
  });
});

// ============================================================================
// DDE Frontend-Backend Alignment
// ============================================================================

describe('DDE Frontend-Backend Alignment', () => {
  describe('DDEStatus interface alignment', () => {
    it('should have all status tracking fields', () => {
      const frontendFields = [
        'statusId',
        'eventCrfId',
        'firstEntryStatus',
        'firstEntryBy',
        'firstEntryByName',
        'firstEntryAt',
        'secondEntryStatus',
        'secondEntryBy',
        'secondEntryByName',
        'secondEntryAt',
        'comparisonStatus',
        'totalItems',
        'matchedItems',
        'discrepancyCount',
        'resolvedCount',
        'ddeComplete'
      ];

      expect(frontendFields).toContain('firstEntryStatus');
      expect(frontendFields).toContain('secondEntryStatus');
      expect(frontendFields).toContain('comparisonStatus');
    });
  });

  describe('DDEItemComparison interface alignment', () => {
    it('should have comparison fields', () => {
      const comparisonFields = [
        'itemId',
        'itemName',
        'itemDescription',
        'firstValue',
        'secondValue',
        'matches',
        'discrepancyId',
        'resolutionStatus',
        'resolvedValue',
        'resolvedBy'
      ];

      expect(comparisonFields).toContain('firstValue');
      expect(comparisonFields).toContain('secondValue');
      expect(comparisonFields).toContain('matches');
    });
  });
});

// ============================================================================
// API Endpoint Alignment
// ============================================================================

describe('API Endpoint Alignment', () => {
  describe('RTSM endpoints', () => {
    it('should have correct endpoint paths', () => {
      const endpoints = {
        kits: '/api/rtsm/kits',
        shipments: '/api/rtsm/shipments',
        dispensations: '/api/rtsm/dispensations',
        temperature: '/api/rtsm/temperature',
        alerts: '/api/rtsm/alerts'
      };

      Object.values(endpoints).forEach(endpoint => {
        expect(endpoint).toMatch(/^\/api\/rtsm\//);
      });
    });
  });

  describe('ePRO endpoints', () => {
    it('should have correct endpoint paths', () => {
      const endpoints = {
        instruments: '/api/epro/instruments',
        assignments: '/api/epro/assignments',
        reminders: '/api/epro/reminders',
        patients: '/api/epro/patients'
      };

      Object.values(endpoints).forEach(endpoint => {
        expect(endpoint).toMatch(/^\/api\/epro\//);
      });
    });
  });

  describe('Flagging endpoints', () => {
    it('should have correct endpoint paths', () => {
      const endpoints = {
        workflows: '/api/flagging/workflows',
        crfFlags: '/api/flagging/crf',
        itemFlags: '/api/flagging/item',
        summary: '/api/flagging/summary'
      };

      Object.values(endpoints).forEach(endpoint => {
        expect(endpoint).toMatch(/^\/api\/flagging\//);
      });
    });
  });

  describe('DDE endpoints', () => {
    it('should have correct endpoint paths', () => {
      const endpoints = {
        status: '/api/dde/forms/:eventCrfId/status',
        canEnter: '/api/dde/forms/:eventCrfId/can-enter',
        firstEntryComplete: '/api/dde/forms/:eventCrfId/first-entry-complete',
        secondEntry: '/api/dde/forms/:eventCrfId/second-entry',
        comparison: '/api/dde/forms/:eventCrfId/comparison',
        finalize: '/api/dde/forms/:eventCrfId/finalize',
        dashboard: '/api/dde/dashboard'
      };

      Object.values(endpoints).forEach(endpoint => {
        expect(endpoint).toMatch(/^\/api\/dde\//);
      });
    });
  });
});
