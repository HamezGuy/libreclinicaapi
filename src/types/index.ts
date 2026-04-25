/**
 * TypeScript Type Definitions — Backend Barrel
 *
 * This file re-exports ALL types from the canonical sources:
 *   - ./libreclinica-models  (re-exports shared-types + backend-only helpers)
 *   - ./wound.types          (wound scanner domain types)
 *   - ./export.types         (export domain types)
 *   - ./template-bundle.types (template bundle interchange format)
 *
 * DO NOT define interfaces in this file. If a type crosses the API boundary,
 * it belongs in @accura-trial/shared-types.
 */

// Re-export all from libreclinica-models (which itself re-exports shared-types)
export * from './libreclinica-models';

// Re-export Wound Scanner types
export * from './wound.types';

// Re-export Export types
export * from './export.types';

/**
 * User — the raw database row shape from user_account table.
 * This is a backend-internal type used by auth/user services for DB row mapping.
 * It includes `passwd` and is NOT the same as shared-types UserAccount.
 */
export interface User {
  userId: number;
  userName: string;
  passwd: string;
  firstName: string;
  lastName: string;
  email: string;
  institutionalAffiliation?: string;
  phone?: string;
  enabled?: boolean;
  accountNonLocked?: boolean;
  userTypeId?: number;
  userType?: string;
  ownerId?: number;
  statusId?: number;
  updateId?: number;
  dateCreated?: Date | string;
  dateLastvisit?: Date | string;
  passwdTimestamp?: Date | string;
  lockCounter?: number;
  runWebservices?: boolean;
  bcryptPasswd?: string;
}
