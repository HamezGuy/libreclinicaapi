/**
 * Unit Tests for Subject Transfer Service
 * 
 * Tests transfer initiation, approval workflow, and completion
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the database pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClientQuery = jest.fn();

jest.mock('../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: mockConnect
  }
}));

jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock e-signature service
jest.mock('../../src/services/database/esignature.service', () => ({
  verifyPasswordForSignature: jest.fn().mockResolvedValue(true),
  applyElectronicSignature: jest.fn().mockResolvedValue({ 
    success: true, 
    data: { signatureId: 1 } 
  })
}));

describe('Transfer Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease
    });
    mockClientQuery.mockImplementation(() => Promise.resolve({ rows: [], rowCount: 0 }));
  });

  describe('initiateTransfer', () => {
    it('should create a new transfer request', async () => {
      // Mock subject lookup
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ 
          rows: [{ study_subject_id: 1, label: 'SUB001', study_id: 1, parent_study_id: null }] 
        }) // subject query
        .mockResolvedValueOnce({ 
          rows: [{ study_id: 2, parent_study_id: 1, name: 'Site B' }] 
        }) // destination site query
        .mockResolvedValueOnce({ rows: [] }) // pending check
        .mockResolvedValueOnce({ rows: [{ transfer_id: 1 }] }) // insert
        .mockResolvedValueOnce({ rows: [] }) // audit log
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      // Mock getTransferDetails
      mockQuery.mockResolvedValueOnce({
        rows: [{
          transfer_id: 1,
          study_subject_id: 1,
          study_id: 1,
          subject_label: 'SUB001',
          source_site_id: 1,
          source_site_name: 'Site A',
          destination_site_id: 2,
          destination_site_name: 'Site B',
          reason_for_transfer: 'Test reason',
          transfer_status: 'pending',
          requires_approvals: true,
          initiated_by: 1,
          initiated_by_name: 'Test User',
          initiated_at: new Date()
        }]
      });

      const { initiateTransfer } = await import('../../src/services/database/transfer.service');
      const result = await initiateTransfer({
        studySubjectId: 1,
        destinationSiteId: 2,
        reasonForTransfer: 'Test reason',
        initiatedBy: 1
      });

      expect(result.transferId).toBe(1);
      expect(result.transferStatus).toBe('pending');
    });

    it('should reject transfer to same site', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ 
          rows: [{ study_subject_id: 1, label: 'SUB001', study_id: 1, parent_study_id: null }] 
        }) // subject query
        .mockResolvedValueOnce({ 
          rows: [{ study_id: 1, parent_study_id: null, name: 'Site A' }] 
        }); // destination site = same site

      const { initiateTransfer } = await import('../../src/services/database/transfer.service');
      
      await expect(initiateTransfer({
        studySubjectId: 1,
        destinationSiteId: 1,
        reasonForTransfer: 'Test',
        initiatedBy: 1
      })).rejects.toThrow('Source and destination sites are the same');
    });

    it('should reject if subject has pending transfer', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ 
          rows: [{ study_subject_id: 1, label: 'SUB001', study_id: 1, parent_study_id: null }] 
        })
        .mockResolvedValueOnce({ 
          rows: [{ study_id: 2, parent_study_id: 1, name: 'Site B' }] 
        })
        .mockResolvedValueOnce({ rows: [{ transfer_id: 99 }] }); // existing pending transfer

      const { initiateTransfer } = await import('../../src/services/database/transfer.service');
      
      await expect(initiateTransfer({
        studySubjectId: 1,
        destinationSiteId: 2,
        reasonForTransfer: 'Test',
        initiatedBy: 1
      })).rejects.toThrow('Subject already has a pending transfer');
    });
  });

  describe('getTransferDetails', () => {
    it('should return transfer details', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          transfer_id: 1,
          study_subject_id: 1,
          study_id: 1,
          subject_label: 'SUB001',
          source_site_id: 1,
          source_site_name: 'Site A',
          destination_site_id: 2,
          destination_site_name: 'Site B',
          reason_for_transfer: 'Relocation',
          transfer_status: 'pending',
          requires_approvals: true,
          initiated_by: 1,
          initiated_by_name: 'Dr. Smith',
          initiated_at: new Date()
        }]
      });

      const { getTransferDetails } = await import('../../src/services/database/transfer.service');
      const result = await getTransferDetails(1);

      expect(result.transferId).toBe(1);
      expect(result.subjectLabel).toBe('SUB001');
      expect(result.sourceSiteName).toBe('Site A');
      expect(result.destinationSiteName).toBe('Site B');
    });

    it('should throw error when transfer not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getTransferDetails } = await import('../../src/services/database/transfer.service');
      
      await expect(getTransferDetails(999)).rejects.toThrow('Transfer not found');
    });
  });

  describe('getTransferHistory', () => {
    it('should return transfer history for subject', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { transfer_id: 1, transfer_status: 'completed', initiated_at: new Date() },
          { transfer_id: 2, transfer_status: 'pending', initiated_at: new Date() }
        ]
      });

      const { getTransferHistory } = await import('../../src/services/database/transfer.service');
      const result = await getTransferHistory(1);

      expect(result).toHaveLength(2);
    });
  });

  describe('hasPendingTransfer', () => {
    it('should return true when pending transfer exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ transfer_id: 1 }] });

      const { hasPendingTransfer } = await import('../../src/services/database/transfer.service');
      const result = await hasPendingTransfer(1);

      expect(result).toBe(true);
    });

    it('should return false when no pending transfer', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { hasPendingTransfer } = await import('../../src/services/database/transfer.service');
      const result = await hasPendingTransfer(1);

      expect(result).toBe(false);
    });
  });

  describe('getAvailableSites', () => {
    it('should return available destination sites', async () => {
      mockQuery
        .mockResolvedValueOnce({ 
          rows: [{ current_site_id: 1, parent_study_id: 10 }] 
        })
        .mockResolvedValueOnce({
          rows: [
            { study_id: 2, name: 'Site B' },
            { study_id: 3, name: 'Site C' }
          ]
        });

      const { getAvailableSites } = await import('../../src/services/database/transfer.service');
      const result = await getAvailableSites(1, 1);

      expect(result).toHaveLength(2);
      expect(result[0].siteName).toBe('Site B');
    });

    it('should return empty array when subject not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getAvailableSites } = await import('../../src/services/database/transfer.service');
      const result = await getAvailableSites(999, 1);

      expect(result).toEqual([]);
    });
  });
});

