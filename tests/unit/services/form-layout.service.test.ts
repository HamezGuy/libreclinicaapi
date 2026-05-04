/**
 * Unit Tests for Form Layout Service
 *
 * Tests layout retrieval and section grouping logic.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: jest.fn(),
  },
  db: {
    query: mockQuery,
  },
}));

jest.mock('../../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Form Layout Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getFormLayout
  // =========================================================================
  describe('getFormLayout', () => {
    it('should return sections and items for a valid crfVersionId', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            sectionId: 1,
            sectionLabel: 'Demographics',
            sectionTitle: 'Demographics Section',
            sectionOrdinal: 1,
            itemFormMetadataId: 10,
            itemId: 100,
            itemName: 'DOB',
            columnNumber: 1,
            itemOrdinal: 1,
            leftItemText: 'Date of Birth',
            rightItemText: '',
            required: true,
            showItem: true,
            responseTypeId: 3,
            widthDecimal: 0,
          },
          {
            sectionId: 1,
            sectionLabel: 'Demographics',
            sectionTitle: 'Demographics Section',
            sectionOrdinal: 1,
            itemFormMetadataId: 11,
            itemId: 101,
            itemName: 'GENDER',
            columnNumber: 2,
            itemOrdinal: 2,
            leftItemText: 'Gender',
            rightItemText: '',
            required: true,
            showItem: true,
            responseTypeId: 5,
            widthDecimal: 0,
          },
        ],
      });

      const { getFormLayout } = await import(
        '../../../src/services/database/form-layout.service'
      );
      const layout = await getFormLayout(42);

      expect(layout.crfVersionId).toBe(42);
      expect(layout.sections).toHaveLength(1);
      expect(layout.sections[0].label).toBe('Demographics');
      expect(layout.sections[0].itemCount).toBe(2);
      expect(layout.items).toHaveLength(2);
      expect(layout.columnCount).toBe(2);
    });

    it('should return empty sections for nonexistent crfVersionId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getFormLayout } = await import(
        '../../../src/services/database/form-layout.service'
      );
      const layout = await getFormLayout(9999);

      expect(layout.crfVersionId).toBe(9999);
      expect(layout.sections).toEqual([]);
      expect(layout.items).toEqual([]);
      expect(layout.columnCount).toBe(1);
    });

    it('should group items by section correctly with multiple sections', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            sectionId: 1,
            sectionLabel: 'Section A',
            sectionTitle: 'First',
            sectionOrdinal: 1,
            itemFormMetadataId: 10,
            itemId: 100,
            itemName: 'FIELD_A1',
            columnNumber: 1,
            itemOrdinal: 1,
            leftItemText: 'Field A1',
            rightItemText: '',
            required: false,
            showItem: true,
            responseTypeId: 1,
            widthDecimal: 0,
          },
          {
            sectionId: 2,
            sectionLabel: 'Section B',
            sectionTitle: 'Second',
            sectionOrdinal: 2,
            itemFormMetadataId: 20,
            itemId: 200,
            itemName: 'FIELD_B1',
            columnNumber: 1,
            itemOrdinal: 1,
            leftItemText: 'Field B1',
            rightItemText: '',
            required: true,
            showItem: true,
            responseTypeId: 1,
            widthDecimal: 0,
          },
          {
            sectionId: 2,
            sectionLabel: 'Section B',
            sectionTitle: 'Second',
            sectionOrdinal: 2,
            itemFormMetadataId: 21,
            itemId: 201,
            itemName: 'FIELD_B2',
            columnNumber: 1,
            itemOrdinal: 2,
            leftItemText: 'Field B2',
            rightItemText: '',
            required: false,
            showItem: true,
            responseTypeId: 1,
            widthDecimal: 0,
          },
        ],
      });

      const { getFormLayout } = await import(
        '../../../src/services/database/form-layout.service'
      );
      const layout = await getFormLayout(55);

      expect(layout.sections).toHaveLength(2);
      expect(layout.sections[0].label).toBe('Section A');
      expect(layout.sections[0].itemCount).toBe(1);
      expect(layout.sections[1].label).toBe('Section B');
      expect(layout.sections[1].itemCount).toBe(2);
      expect(layout.items).toHaveLength(3);
    });

    it('should sort sections by ordinal', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            sectionId: 5,
            sectionLabel: 'Last',
            sectionTitle: 'Last Section',
            sectionOrdinal: 3,
            itemFormMetadataId: 30,
            itemId: 300,
            itemName: 'X',
            columnNumber: 1,
            itemOrdinal: 1,
            leftItemText: 'X',
            rightItemText: '',
            required: false,
            showItem: true,
            responseTypeId: 1,
            widthDecimal: 0,
          },
          {
            sectionId: 3,
            sectionLabel: 'First',
            sectionTitle: 'First Section',
            sectionOrdinal: 1,
            itemFormMetadataId: 31,
            itemId: 301,
            itemName: 'Y',
            columnNumber: 1,
            itemOrdinal: 1,
            leftItemText: 'Y',
            rightItemText: '',
            required: false,
            showItem: true,
            responseTypeId: 1,
            widthDecimal: 0,
          },
        ],
      });

      const { getFormLayout } = await import(
        '../../../src/services/database/form-layout.service'
      );
      const layout = await getFormLayout(77);

      expect(layout.sections[0].label).toBe('First');
      expect(layout.sections[1].label).toBe('Last');
    });

    it('should default columnNumber to 1 when null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            sectionId: 1,
            sectionLabel: 'S',
            sectionTitle: 'S',
            sectionOrdinal: 1,
            itemFormMetadataId: 40,
            itemId: 400,
            itemName: 'FIELD',
            columnNumber: null,
            itemOrdinal: 1,
            leftItemText: 'Label',
            rightItemText: '',
            required: false,
            showItem: null,
            responseTypeId: 1,
            widthDecimal: 0,
          },
        ],
      });

      const { getFormLayout } = await import(
        '../../../src/services/database/form-layout.service'
      );
      const layout = await getFormLayout(88);

      expect(layout.items[0].columnNumber).toBe(1);
      expect(layout.items[0].showItem).toBe(true);
      expect(layout.columnCount).toBe(1);
    });
  });
});
