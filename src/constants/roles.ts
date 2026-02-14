/**
 * AccuraTrials EDC — Role Constants
 * 
 * Industry-standard EDC roles aligned with:
 *   - ICH E6(R3) GCP responsibilities
 *   - 21 CFR Part 11 §11.10(d) access controls
 *   - Medidata Rave, Veeva Vault CDMS, REDCap, OpenClinica role patterns
 * 
 * 6 roles (simplified from legacy 8):
 *   1. admin         — System Administrator
 *   2. data_manager  — Data Manager (data quality, lock, export, validation rules)
 *   3. investigator  — Investigator / PI (e-sign authority, enter/view data)
 *   4. coordinator   — Clinical Research Coordinator (primary data entry, manage subjects)
 *   5. monitor       — Monitor / CRA (SDV, queries, read-only data access)
 *   6. viewer        — Sponsor / Read-Only
 * 
 * Legacy LibreClinica role names (director, ra, ra2) are mapped to these 6 via aliases
 * in getRoleByName() so existing study_user_role data remains valid.
 */

export interface LibreClinicaRole {
  id: number;
  name: string;
  description: string;
  displayName: string;
  /** Can enter/edit eCRF data */
  canSubmitData: boolean;
  /** Can export/extract study data */
  canExtractData: boolean;
  /** Can manage study configuration, sites, CRF design */
  canManageStudy: boolean;
  /** Can perform SDV and monitoring activities */
  canMonitor: boolean;
  /** Can apply electronic signatures on eCRFs (21 CFR Part 11) */
  canSign: boolean;
  /** Can lock/freeze data */
  canLockData: boolean;
  /** Can manage users */
  canManageUsers: boolean;
}

// ============================================================================
// Role Definitions — 6 industry-standard EDC roles
// ============================================================================

export const ROLES = {
  INVALID: {
    id: 0, name: 'invalid', description: 'Invalid Role', displayName: 'Invalid',
    canSubmitData: false, canExtractData: false, canManageStudy: false,
    canMonitor: false, canSign: false, canLockData: false, canManageUsers: false
  } as LibreClinicaRole,

  ADMIN: {
    id: 1, name: 'admin', description: 'System_Administrator', displayName: 'System Administrator',
    canSubmitData: true, canExtractData: true, canManageStudy: true,
    canMonitor: true, canSign: true, canLockData: true, canManageUsers: true
  } as LibreClinicaRole,

  DATA_MANAGER: {
    id: 2, name: 'data_manager', description: 'Data_Manager', displayName: 'Data Manager',
    canSubmitData: true, canExtractData: true, canManageStudy: true,
    canMonitor: false, canSign: false, canLockData: true, canManageUsers: false
  } as LibreClinicaRole,

  INVESTIGATOR: {
    id: 3, name: 'investigator', description: 'Investigator', displayName: 'Investigator',
    canSubmitData: true, canExtractData: true, canManageStudy: false,
    canMonitor: false, canSign: true, canLockData: false, canManageUsers: false
  } as LibreClinicaRole,

  COORDINATOR: {
    id: 4, name: 'coordinator', description: 'Clinical_Research_Coordinator', displayName: 'Clinical Research Coordinator',
    canSubmitData: true, canExtractData: false, canManageStudy: false,
    canMonitor: false, canSign: false, canLockData: false, canManageUsers: false
  } as LibreClinicaRole,

  MONITOR: {
    id: 5, name: 'monitor', description: 'Monitor', displayName: 'Monitor / CRA',
    canSubmitData: false, canExtractData: false, canManageStudy: false,
    canMonitor: true, canSign: false, canLockData: false, canManageUsers: false
  } as LibreClinicaRole,

  VIEWER: {
    id: 6, name: 'viewer', description: 'Sponsor_ReadOnly', displayName: 'Read-Only / Sponsor',
    canSubmitData: false, canExtractData: false, canManageStudy: false,
    canMonitor: false, canSign: false, canLockData: false, canManageUsers: false
  } as LibreClinicaRole,
};

// ============================================================================
// Canonical role list (what the UI shows in dropdowns)
// ============================================================================

export const ALL_ROLES: LibreClinicaRole[] = [
  ROLES.ADMIN,
  ROLES.DATA_MANAGER,
  ROLES.INVESTIGATOR,
  ROLES.COORDINATOR,
  ROLES.MONITOR,
  ROLES.VIEWER,
];

// ============================================================================
// Legacy/alias mappings — backwards compatibility with LibreClinica DB
// study_user_role.role_name may contain any of these strings from older data.
// ============================================================================

/**
 * Get role by name.
 * Handles current role names, legacy LibreClinica names, and site-level aliases.
 */
export const getRoleByName = (name: string): LibreClinicaRole => {
  const n = name.toLowerCase().trim();

  // Direct match on current role names
  for (const role of ALL_ROLES) {
    if (role.name === n) return role;
  }

  // Legacy and alias mappings (LibreClinica DB backwards compatibility)
  const ALIAS_MAP: Record<string, LibreClinicaRole> = {
    // Admin aliases
    'system_administrator': ROLES.ADMIN,

    // Data Manager aliases (legacy names that meant study management)
    // NOTE: bare 'coordinator' is NOT here — direct match returns ROLES.COORDINATOR (CRC)
    'study_coordinator': ROLES.DATA_MANAGER,
    'site_study_coordinator': ROLES.DATA_MANAGER,
    'director': ROLES.DATA_MANAGER,
    'study_director': ROLES.DATA_MANAGER,
    'site_study_director': ROLES.DATA_MANAGER,

    // Investigator aliases
    'site_investigator': ROLES.INVESTIGATOR,

    // Coordinator (CRC) aliases (was ra/data_entry in legacy)
    'ra': ROLES.COORDINATOR,
    'ra2': ROLES.COORDINATOR,
    'data_entry': ROLES.COORDINATOR,
    'data_entry_person': ROLES.COORDINATOR,
    'site_data_entry_person': ROLES.COORDINATOR,
    'site_data_entry_person2': ROLES.COORDINATOR,
    'user': ROLES.COORDINATOR,
    'crc': ROLES.COORDINATOR,

    // Monitor aliases
    'site_monitor': ROLES.MONITOR,

    // Viewer aliases
    'sponsor': ROLES.VIEWER,
    'read_only': ROLES.VIEWER,
  };

  if (ALIAS_MAP[n]) return ALIAS_MAP[n];

  // Description match
  for (const role of ALL_ROLES) {
    if (role.description.toLowerCase() === n) return role;
  }

  return ROLES.INVALID;
};

/**
 * Get role by ID
 */
export const getRoleById = (id: number): LibreClinicaRole => {
  return ALL_ROLES.find(r => r.id === id) || ROLES.INVALID;
};

/**
 * Get the highest privilege role from a list of role names.
 * Lower ID = higher privilege.
 */
export const getHighestRole = (roleNames: string[]): LibreClinicaRole => {
  let highest: LibreClinicaRole = ROLES.INVALID;
  for (const name of roleNames) {
    const role = getRoleByName(name);
    if (role.id !== 0 && (highest.id === 0 || role.id < highest.id)) {
      highest = role;
    }
  }
  return highest;
};

// Convenience permission checks
export const roleHasPermission = (
  roleName: string,
  permission: 'submitData' | 'extractData' | 'manageStudy' | 'monitor' | 'sign' | 'lockData' | 'manageUsers'
): boolean => {
  const role = getRoleByName(roleName);
  const map: Record<string, boolean> = {
    submitData: role.canSubmitData,
    extractData: role.canExtractData,
    manageStudy: role.canManageStudy,
    monitor: role.canMonitor,
    sign: role.canSign,
    lockData: role.canLockData,
    manageUsers: role.canManageUsers,
  };
  return map[permission] ?? false;
};

export const isAdmin = (roleName: string): boolean => getRoleByName(roleName).id === ROLES.ADMIN.id;
export const canManageStudy = (roleName: string): boolean => getRoleByName(roleName).canManageStudy;
export const canSubmitData = (roleName: string): boolean => getRoleByName(roleName).canSubmitData;

// Legacy exports for backward compatibility (site/study maps not needed with new aliases)
export const SITE_ROLE_MAP: Record<number, string> = {};
export const STUDY_ROLE_MAP: Record<number, string> = {};

export default {
  ROLES, ALL_ROLES, getRoleById, getRoleByName, getHighestRole,
  roleHasPermission, isAdmin, canManageStudy, canSubmitData,
  SITE_ROLE_MAP, STUDY_ROLE_MAP,
};
