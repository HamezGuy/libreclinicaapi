/**
 * Unit Tests — Date Handling Fixes
 * 
 * Verifies the critical date handling fix:
 * - enrollmentDate fallback chain (enrollment → screening → today)
 * - No null/undefined dates passed to new Date()
 * - formatDate never returns 1970
 */

import { formatDate, parseDate, today, parseDateLocal } from '../../src/utils/date.util';

describe('Date Utility — Bug Fix Verification', () => {

  describe('formatDate', () => {
    it('should format a Date object to YYYY-MM-DD', () => {
      const result = formatDate(new Date(2026, 2, 30)); // March 30 2026
      expect(result).toBe('2026-03-30');
    });

    it('should format an ISO string to YYYY-MM-DD', () => {
      const result = formatDate('2026-03-15');
      expect(result).toBe('2026-03-15');
    });

    it('should return empty string for null', () => {
      const result = formatDate(null);
      expect(result).toBe('');
    });

    it('should return empty string for undefined', () => {
      const result = formatDate(undefined);
      expect(result).toBe('');
    });

    it('should return empty string for empty string', () => {
      const result = formatDate('');
      expect(result).toBe('');
    });

    it('should NOT return 1970 for null', () => {
      const result = formatDate(null);
      expect(result).not.toContain('1970');
    });
  });

  describe('today()', () => {
    it('should return current date in YYYY-MM-DD format', () => {
      const result = today();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result).not.toContain('1970');
    });
  });

  describe('Enrollment date fallback chain simulation', () => {
    function getEffectiveEnrollmentDate(
      enrollmentDate?: string | null,
      screeningDate?: string | null
    ): string {
      return enrollmentDate || screeningDate || formatDate(new Date());
    }

    it('should use enrollmentDate when provided', () => {
      const result = getEffectiveEnrollmentDate('2026-03-15', '2026-03-10');
      expect(result).toBe('2026-03-15');
    });

    it('should fall back to screeningDate when enrollmentDate is empty', () => {
      const result = getEffectiveEnrollmentDate('', '2026-03-10');
      expect(result).toBe('2026-03-10');
    });

    it('should fall back to screeningDate when enrollmentDate is null', () => {
      const result = getEffectiveEnrollmentDate(null, '2026-03-10');
      expect(result).toBe('2026-03-10');
    });

    it('should fall back to today when both are empty', () => {
      const result = getEffectiveEnrollmentDate('', '');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result).not.toContain('1970');
    });

    it('should fall back to today when both are null', () => {
      const result = getEffectiveEnrollmentDate(null, null);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result).not.toContain('1970');
    });

    it('should fall back to today when both are undefined', () => {
      const result = getEffectiveEnrollmentDate(undefined, undefined);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result).not.toContain('1970');
    });
  });

  describe('Visit date calculation simulation', () => {
    it('should schedule visits relative to enrollment date (not 1970)', () => {
      const enrollmentDate = '2026-03-30';
      const scheduleDays = [0, 7, 28, 56];

      for (const day of scheduleDays) {
        const eventStart = new Date(enrollmentDate);
        eventStart.setDate(eventStart.getDate() + day);
        const formatted = formatDate(eventStart);

        expect(formatted).not.toContain('1970');
        expect(new Date(formatted).getFullYear()).toBe(2026);
      }
    });

    it('should NOT produce 1970 when enrollment date is auto-set to today', () => {
      const fallbackDate = formatDate(new Date());
      const eventStart = new Date(fallbackDate);
      eventStart.setDate(eventStart.getDate() + 28);

      expect(formatDate(eventStart)).not.toContain('1970');
      expect(eventStart.getFullYear()).toBeGreaterThan(2020);
    });

    it('new Date(null) produces epoch — this is the bug we fixed', () => {
      // This test documents the root cause of the bug
      const badDate = new Date(null as any);
      expect(badDate.getFullYear()).toBe(1970);

      // Our fix: never pass null to new Date()
      const nullVal: string | null = null;
      const goodDate = nullVal || formatDate(new Date());
      const safeDate = new Date(goodDate);
      expect(safeDate.getFullYear()).toBeGreaterThan(2020);
    });
  });

  describe('parseDateLocal — timezone safety', () => {
    it('should parse YYYY-MM-DD as local date, not UTC', () => {
      const result = parseDateLocal('2026-03-15');
      expect(result).toBeTruthy();
      expect(result!.getDate()).toBe(15);
      expect(result!.getMonth()).toBe(2); // March = 2 (0-indexed)
      expect(result!.getFullYear()).toBe(2026);
    });

    it('should return null for null input', () => {
      expect(parseDateLocal(null)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseDateLocal('')).toBeNull();
    });
  });
});
