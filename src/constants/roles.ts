/**
 * LibreClinica Role Constants
 * 
 * These role definitions match the LibreClinica Role.java constants exactly.
 * Roles are stored in study_user_role.role_name as strings.
 * 
 * Source: org.akaza.openclinica.bean.core.Role
 */

/**
 * Role interface matching LibreClinica structure
 */
export interface LibreClinicaRole {
  id: number;
  name: string;
  description: string;
  canSubmitData: boolean;
  canExtractData: boolean;
  canManageStudy: boolean;
  canMonitor: boolean;
}

/**
 * LibreClinica role definitions
 * These match the Role.java constants exactly
 */
export const ROLES = {
  INVALID: {
    id: 0,
    name: 'invalid',
    description: 'Invalid Role',
    canSubmitData: false,
    canExtractData: false,
    canManageStudy: false,
    canMonitor: false
  } as LibreClinicaRole,

  ADMIN: {
    id: 1,
    name: 'admin',
    description: 'System_Administrator',
    canSubmitData: true,
    canExtractData: true,
    canManageStudy: true,
    canMonitor: true
  } as LibreClinicaRole,

  COORDINATOR: {
    id: 2,
    name: 'coordinator',
    description: 'Study_Coordinator',
    canSubmitData: true,
    canExtractData: true,
    canManageStudy: true,
    canMonitor: false
  } as LibreClinicaRole,

  STUDYDIRECTOR: {
    id: 3,
    name: 'director',
    description: 'Study_Director',
    canSubmitData: true,
    canExtractData: true,
    canManageStudy: true,
    canMonitor: false
  } as LibreClinicaRole,

  INVESTIGATOR: {
    id: 4,
    name: 'Investigator',
    description: 'Investigator',
    canSubmitData: true,
    canExtractData: true,
    canManageStudy: false,
    canMonitor: false
  } as LibreClinicaRole,

  RESEARCHASSISTANT: {
    id: 5,
    name: 'ra',
    description: 'Data_Entry_Person',
    canSubmitData: true,
    canExtractData: false,
    canManageStudy: false,
    canMonitor: false
  } as LibreClinicaRole,

  MONITOR: {
    id: 6,
    name: 'monitor',
    description: 'Monitor',
    canSubmitData: false,
    canExtractData: false,
    canManageStudy: false,
    canMonitor: true
  } as LibreClinicaRole,

  RESEARCHASSISTANT2: {
    id: 7,
    name: 'ra2',
    description: 'site_Data_Entry_Person2',
    canSubmitData: true,
    canExtractData: false,
    canManageStudy: false,
    canMonitor: false
  } as LibreClinicaRole
};

/**
 * Site-level role name mappings (used for sites/child studies)
 * Maps role ID to site-specific role name
 */
export const SITE_ROLE_MAP: Record<number, string> = {
  2: 'site_Study_Coordinator',
  3: 'site_Study_Director',
  4: 'site_investigator',
  5: 'site_Data_Entry_Person',
  6: 'site_monitor',
  7: 'site_Data_Entry_Person2'
};

/**
 * Study-level role name mappings (used for parent studies)
 * Maps role ID to study-specific role name
 */
export const STUDY_ROLE_MAP: Record<number, string> = {
  2: 'Study_Coordinator',
  3: 'Study_Director',
  4: 'Investigator',
  5: 'Data_Entry_Person',
  6: 'Monitor'
};

/**
 * All roles as array (excluding INVALID)
 */
export const ALL_ROLES: LibreClinicaRole[] = [
  ROLES.ADMIN,
  ROLES.COORDINATOR,
  ROLES.STUDYDIRECTOR,
  ROLES.INVESTIGATOR,
  ROLES.RESEARCHASSISTANT,
  ROLES.MONITOR,
  ROLES.RESEARCHASSISTANT2
];

/**
 * Get role by ID
 */
export const getRoleById = (id: number): LibreClinicaRole => {
  const role = ALL_ROLES.find(r => r.id === id);
  return role || ROLES.INVALID;
};

/**
 * Get role by name (matches role_name column in study_user_role)
 * Handles both study and site role names
 */
export const getRoleByName = (name: string): LibreClinicaRole => {
  // Normalize the name (lowercase for comparison)
  const normalizedName = name.toLowerCase().trim();

  // Direct match on role name
  for (const role of ALL_ROLES) {
    if (role.name.toLowerCase() === normalizedName) {
      return role;
    }
  }

  // Match on description
  for (const role of ALL_ROLES) {
    if (role.description.toLowerCase() === normalizedName) {
      return role;
    }
  }

  // Match site role names
  const siteRoleMappings: Record<string, LibreClinicaRole> = {
    'site_study_coordinator': ROLES.COORDINATOR,
    'site_study_director': ROLES.STUDYDIRECTOR,
    'site_investigator': ROLES.INVESTIGATOR,
    'site_data_entry_person': ROLES.RESEARCHASSISTANT,
    'site_monitor': ROLES.MONITOR,
    'site_data_entry_person2': ROLES.RESEARCHASSISTANT2
  };

  if (siteRoleMappings[normalizedName]) {
    return siteRoleMappings[normalizedName];
  }

  // Match study role names
  const studyRoleMappings: Record<string, LibreClinicaRole> = {
    'study_coordinator': ROLES.COORDINATOR,
    'study_director': ROLES.STUDYDIRECTOR,
    'investigator': ROLES.INVESTIGATOR,
    'data_entry_person': ROLES.RESEARCHASSISTANT,
    'monitor': ROLES.MONITOR,
    'system_administrator': ROLES.ADMIN
  };

  if (studyRoleMappings[normalizedName]) {
    return studyRoleMappings[normalizedName];
  }

  return ROLES.INVALID;
};

/**
 * Get the highest privilege role from a list of role names
 * Lower ID = higher privilege (admin=1 is highest)
 */
export const getHighestRole = (roleNames: string[]): LibreClinicaRole => {
  let highestRole: LibreClinicaRole = ROLES.INVALID;

  for (const name of roleNames) {
    const role = getRoleByName(name);
    if (role.id !== 0 && (highestRole.id === 0 || role.id < highestRole.id)) {
      highestRole = role;
    }
  }

  return highestRole;
};

/**
 * Check if a role has a specific permission
 */
export const roleHasPermission = (
  roleName: string,
  permission: 'submitData' | 'extractData' | 'manageStudy' | 'monitor'
): boolean => {
  const role = getRoleByName(roleName);
  
  switch (permission) {
    case 'submitData':
      return role.canSubmitData;
    case 'extractData':
      return role.canExtractData;
    case 'manageStudy':
      return role.canManageStudy;
    case 'monitor':
      return role.canMonitor;
    default:
      return false;
  }
};

/**
 * Check if user is admin
 */
export const isAdmin = (roleName: string): boolean => {
  const role = getRoleByName(roleName);
  return role.id === ROLES.ADMIN.id;
};

/**
 * Check if user can manage studies (Coordinator, Director, or Admin)
 */
export const canManageStudy = (roleName: string): boolean => {
  const role = getRoleByName(roleName);
  return role.canManageStudy;
};

/**
 * Check if user can submit data (most roles except monitor and invalid)
 */
export const canSubmitData = (roleName: string): boolean => {
  const role = getRoleByName(roleName);
  return role.canSubmitData;
};

export default {
  ROLES,
  ALL_ROLES,
  SITE_ROLE_MAP,
  STUDY_ROLE_MAP,
  getRoleById,
  getRoleByName,
  getHighestRole,
  roleHasPermission,
  isAdmin,
  canManageStudy,
  canSubmitData
};

