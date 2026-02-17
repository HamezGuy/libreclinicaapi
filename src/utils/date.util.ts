/**
 * Centralized Date Utility (Backend)
 * 
 * ALL date formatting, parsing, and conversion in the backend should use
 * these functions for consistent ISO 8601 (YYYY-MM-DD) handling.
 * 
 * Formats:
 *   - Date only:     YYYY-MM-DD          (e.g. 2025-11-29)
 *   - DateTime:      YYYY-MM-DD HH:mm    (e.g. 2025-11-29 14:30)
 *   - Full DateTime: YYYY-MM-DD HH:mm:ss (e.g. 2025-11-29 14:30:45)
 *   - ISO 8601:      YYYY-MM-DDTHH:mm:ss.sssZ (for API timestamps)
 * 
 * Database Notes:
 *   - PostgreSQL stores TIMESTAMP in UTC; conversion happens at read time.
 *   - Use formatDate() for date-only columns (enrollment_date, date_of_birth).
 *   - Use toISOTimestamp() for full timestamp columns (date_created, date_updated).
 *   - Use parseDate() to safely parse any incoming date value.
 */

/**
 * Pad a number to 2 digits with leading zero.
 */
function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Parse any date-like value to a Date object.
 * Returns null if the value is not a valid date.
 */
export function parseDate(value: Date | string | number | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Check if a value is a valid date.
 */
export function isValidDate(value: any): boolean {
  return parseDate(value) !== null;
}

/**
 * Format a date to YYYY-MM-DD (date only, local timezone).
 * 
 * Use for: enrollment_date, date_of_birth, screening_date, event dates.
 * Avoids the UTC offset issue with toISOString().split('T')[0].
 */
export function formatDate(value: Date | string | number | null | undefined): string {
  if (!value) return '';
  const d = parseDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Format a date to YYYY-MM-DD HH:mm (datetime, local timezone).
 */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (!value) return '';
  const d = parseDate(value);
  if (!d) return '';
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Format a date to YYYY-MM-DD HH:mm:ss (full datetime, local timezone).
 */
export function formatDateTimeFull(value: Date | string | number | null | undefined): string {
  if (!value) return '';
  const d = parseDate(value);
  if (!d) return '';
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Get an ISO 8601 timestamp string (UTC): YYYY-MM-DDTHH:mm:ss.sssZ
 * 
 * Use for: audit timestamps, API response timestamps, date_created fields.
 */
export function toISOTimestamp(value?: Date | string | number | null): string {
  if (!value) return new Date().toISOString();
  const d = parseDate(value);
  return d ? d.toISOString() : new Date().toISOString();
}

/**
 * Get today's date as YYYY-MM-DD (local timezone).
 */
export function today(): string {
  return formatDate(new Date());
}

/**
 * Get current datetime as YYYY-MM-DD HH:mm:ss (local timezone).
 */
export function now(): string {
  return formatDateTimeFull(new Date());
}

/**
 * Safely format a database row's date field for API response.
 * Handles both Date objects and string values from PostgreSQL.
 * 
 * @param value - The date value from the database row
 * @param includeTime - Whether to include time component
 */
export function formatDbDate(
  value: Date | string | null | undefined,
  includeTime: boolean = false
): string {
  if (!value) return '';
  if (includeTime) {
    return formatDateTimeFull(value);
  }
  return formatDate(value);
}

/**
 * Calculate age in whole years from a date of birth.
 */
export function calculateAge(dateOfBirth: Date | string | null | undefined): number | null {
  const dob = parseDate(dateOfBirth);
  if (!dob) return null;
  const todayDate = new Date();
  let age = todayDate.getFullYear() - dob.getFullYear();
  const monthDiff = todayDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && todayDate.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}
