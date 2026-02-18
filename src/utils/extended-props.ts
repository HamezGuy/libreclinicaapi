/**
 * Extended Properties Utility
 * 
 * Single source of truth for parsing and stripping the ---EXTENDED_PROPS---
 * delimiter embedded in item.description fields. This convention stores
 * frontend-specific metadata (type, fieldName, tableColumns, showWhen, etc.)
 * inside the LibreClinica item description column.
 * 
 * EVERY service that reads item.description should use these functions
 * instead of inlining its own parsing logic.
 */

const DELIMITER = '---EXTENDED_PROPS---';

/**
 * Strip the ---EXTENDED_PROPS--- section from a description string,
 * returning only the human-readable portion.
 */
export function stripExtendedProps(description: string | null | undefined): string {
  if (!description) return '';
  const idx = description.indexOf(DELIMITER);
  return idx >= 0 ? description.substring(0, idx).trim() : description;
}

/**
 * Parse the JSON object from the ---EXTENDED_PROPS--- section.
 * Returns an empty object if the delimiter is absent or the JSON is invalid.
 */
export function parseExtendedProps(description: string | null | undefined): Record<string, any> {
  if (!description?.includes(DELIMITER)) return {};
  try {
    const json = description.split(DELIMITER)[1]?.trim();
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

/**
 * Check whether a description string contains extended properties.
 */
export function hasExtendedProps(description: string | null | undefined): boolean {
  return !!description && description.includes(DELIMITER);
}
