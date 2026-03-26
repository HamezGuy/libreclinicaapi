/**
 * Feature-to-Permission Traceability Matrix
 *
 * Maps every backend route to:
 *   - Required backend roles (from requireRole middleware)
 *   - Frontend permission flag(s) that gate the feature in the UI
 *   - Whether the permission is assignable in the user management screen
 *
 * This file serves as living documentation AND as test input for the
 * user-management integration tests.
 */

export interface RoutePermission {
  method: string;
  path: string;
  requiredRoles: string[];
  frontendPermissions: string[];
  assignableInUI: boolean;
  feature: string;
  notes?: string;
}

export interface PermissionMatrixEntry {
  routeFile: string;
  blanketRoles: string[];
  routes: RoutePermission[];
}

// ============================================================================
// BACKEND ROUTE → ROLE MATRIX
// ============================================================================

export const PERMISSION_MATRIX: PermissionMatrixEntry[] = [
  // ── USER MANAGEMENT ──
  {
    routeFile: 'user.routes.ts',
    blanketRoles: ['admin', 'data_manager'],
    routes: [
      { method: 'GET', path: '/api/users', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canViewUsers'], assignableInUI: true, feature: 'List users' },
      { method: 'GET', path: '/api/users/:id', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canViewUsers'], assignableInUI: true, feature: 'Get user detail' },
      { method: 'POST', path: '/api/users', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canCreateUsers'], assignableInUI: true, feature: 'Create user' },
      { method: 'PUT', path: '/api/users/:id', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditUsers'], assignableInUI: true, feature: 'Update user' },
      { method: 'DELETE', path: '/api/users/:id', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canDeleteUsers'], assignableInUI: true, feature: 'Delete user' },
      { method: 'GET', path: '/api/users/meta/roles', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canManageRoles'], assignableInUI: true, feature: 'List available roles' },
      { method: 'POST', path: '/api/users/:id/assign-study', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canManageRoles'], assignableInUI: true, feature: 'Assign user to study' },
      { method: 'GET', path: '/api/users/:id/features', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditUsers'], assignableInUI: true, feature: 'Get user feature access' },
      { method: 'PUT', path: '/api/users/:id/features', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditUsers'], assignableInUI: true, feature: 'Set user features' },
      { method: 'PUT', path: '/api/users/:id/features/:featureKey', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditUsers'], assignableInUI: true, feature: 'Toggle user feature' },
      { method: 'DELETE', path: '/api/users/:id/features/:featureKey', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditUsers'], assignableInUI: true, feature: 'Remove feature override' },
    ],
  },

  // ── PERMISSIONS (a la carte) ──
  {
    routeFile: 'permission.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/permissions/available', requiredRoles: [], frontendPermissions: [], assignableInUI: false, feature: 'List available permissions' },
      { method: 'GET', path: '/api/permissions/me', requiredRoles: [], frontendPermissions: [], assignableInUI: false, feature: 'Get own permissions' },
      { method: 'GET', path: '/api/permissions/:userId', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditUsers'], assignableInUI: true, feature: 'Get user permissions' },
      { method: 'PUT', path: '/api/permissions/:userId', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditUsers'], assignableInUI: true, feature: 'Set user permissions' },
      { method: 'DELETE', path: '/api/permissions/:userId/:key', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditUsers'], assignableInUI: true, feature: 'Remove permission override' },
    ],
  },

  // ── FORMS / CRF TEMPLATES ──
  {
    routeFile: 'form.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/forms', requiredRoles: [], frontendPermissions: ['canViewTemplates'], assignableInUI: true, feature: 'List form templates' },
      { method: 'GET', path: '/api/forms/:id', requiredRoles: [], frontendPermissions: ['canViewTemplates'], assignableInUI: true, feature: 'Get form template' },
      { method: 'POST', path: '/api/forms', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canCreateTemplates'], assignableInUI: true, feature: 'Create form template' },
      { method: 'PUT', path: '/api/forms/:id', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditTemplates'], assignableInUI: true, feature: 'Update form template (403 error source)' },
      { method: 'DELETE', path: '/api/forms/:id', requiredRoles: ['admin'], frontendPermissions: ['canDeleteTemplates'], assignableInUI: true, feature: 'Delete form template' },
      { method: 'POST', path: '/api/forms/:id/archive', requiredRoles: ['admin'], frontendPermissions: ['canDeleteTemplates'], assignableInUI: true, feature: 'Archive form' },
      { method: 'POST', path: '/api/forms/:id/restore', requiredRoles: ['admin'], frontendPermissions: ['canDeleteTemplates'], assignableInUI: true, feature: 'Restore form' },
      { method: 'GET', path: '/api/forms/archived', requiredRoles: ['admin'], frontendPermissions: ['canDeleteTemplates'], assignableInUI: true, feature: 'View archived forms' },
      { method: 'POST', path: '/api/forms/save', requiredRoles: ['data_manager', 'coordinator', 'investigator'], frontendPermissions: ['canFillForms'], assignableInUI: true, feature: 'Save form data' },
      { method: 'PATCH', path: '/api/forms/field/:eventCrfId', requiredRoles: ['data_manager', 'coordinator', 'investigator'], frontendPermissions: ['canEditForms'], assignableInUI: true, feature: 'Patch single field' },
      { method: 'PUT', path: '/api/forms/workflow-config/:crfId', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditTemplates'], assignableInUI: true, feature: 'Update workflow config' },
    ],
  },

  // ── STUDIES ──
  {
    routeFile: 'study.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/studies', requiredRoles: [], frontendPermissions: ['canViewStudies'], assignableInUI: true, feature: 'List studies' },
      { method: 'GET', path: '/api/studies/:id', requiredRoles: [], frontendPermissions: ['canViewStudies'], assignableInUI: true, feature: 'Get study detail' },
      { method: 'POST', path: '/api/studies', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canCreateStudies'], assignableInUI: true, feature: 'Create study' },
      { method: 'PUT', path: '/api/studies/:id', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditStudies'], assignableInUI: true, feature: 'Update study' },
      { method: 'DELETE', path: '/api/studies/:id', requiredRoles: ['admin'], frontendPermissions: ['canDeleteStudies'], assignableInUI: true, feature: 'Delete study' },
    ],
  },

  // ── SUBJECTS / PATIENTS ──
  {
    routeFile: 'subject.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/subjects', requiredRoles: [], frontendPermissions: ['canViewPatients'], assignableInUI: true, feature: 'List subjects' },
      { method: 'POST', path: '/api/subjects', requiredRoles: ['data_manager', 'coordinator', 'investigator'], frontendPermissions: ['canAddPatients', 'canEnrollPatients'], assignableInUI: true, feature: 'Create subject' },
      { method: 'PUT', path: '/api/subjects/:id', requiredRoles: ['data_manager', 'coordinator', 'investigator'], frontendPermissions: ['canEditPatients'], assignableInUI: true, feature: 'Update subject' },
      { method: 'DELETE', path: '/api/subjects/:id', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canDeletePatients'], assignableInUI: true, feature: 'Delete subject' },
    ],
  },

  // ── EVENTS / VISITS ──
  {
    routeFile: 'event.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/events', requiredRoles: [], frontendPermissions: ['canViewStudies'], assignableInUI: true, feature: 'List events' },
      { method: 'POST', path: '/api/events', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditStudies', 'canManageStudyPhases'], assignableInUI: true, feature: 'Create event definition' },
      { method: 'PUT', path: '/api/events/:id', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canEditStudies'], assignableInUI: true, feature: 'Update event definition' },
      { method: 'DELETE', path: '/api/events/:id', requiredRoles: ['admin'], frontendPermissions: ['canDeleteStudies'], assignableInUI: true, feature: 'Delete event definition' },
      { method: 'POST', path: '/api/events/schedule', requiredRoles: ['data_manager', 'coordinator', 'investigator'], frontendPermissions: ['canFillForms'], assignableInUI: true, feature: 'Schedule visit' },
      { method: 'POST', path: '/api/events/unscheduled', requiredRoles: ['admin', 'data_manager', 'coordinator', 'investigator'], frontendPermissions: ['canFillForms'], assignableInUI: true, feature: 'Create unscheduled visit' },
    ],
  },

  // ── DATA QUERIES ──
  {
    routeFile: 'query.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/queries', requiredRoles: [], frontendPermissions: ['canViewDataQueries'], assignableInUI: true, feature: 'List queries' },
      { method: 'POST', path: '/api/queries', requiredRoles: ['admin', 'data_manager', 'coordinator', 'investigator', 'monitor'], frontendPermissions: ['canCreateDataQueries'], assignableInUI: true, feature: 'Create query' },
      { method: 'PUT', path: '/api/queries/:id/status', requiredRoles: ['monitor', 'data_manager', 'admin'], frontendPermissions: ['canResolveDataQueries'], assignableInUI: true, feature: 'Update query status' },
      { method: 'PUT', path: '/api/queries/:id/reassign', requiredRoles: ['data_manager', 'admin'], frontendPermissions: ['canResolveDataQueries'], assignableInUI: true, feature: 'Reassign query' },
    ],
  },

  // ── DATA LOCKS ──
  {
    routeFile: 'data-locks.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'POST', path: '/api/data-locks', requiredRoles: ['monitor', 'data_manager', 'admin'], frontendPermissions: ['canLockForms'], assignableInUI: true, feature: 'Lock form data' },
      { method: 'DELETE', path: '/api/data-locks/:eventCrfId', requiredRoles: ['admin'], frontendPermissions: ['canLockForms'], assignableInUI: true, feature: 'Unlock form data', notes: 'Admin only' },
      { method: 'POST', path: '/api/data-locks/freeze/:eventCrfId', requiredRoles: ['monitor', 'data_manager', 'admin'], frontendPermissions: ['canLockForms'], assignableInUI: true, feature: 'Freeze form data' },
    ],
  },

  // ── SDV ──
  {
    routeFile: 'sdv.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/sdv', requiredRoles: [], frontendPermissions: ['canViewSdv'], assignableInUI: true, feature: 'List SDV records' },
      { method: 'PUT', path: '/api/sdv/:id/verify', requiredRoles: ['monitor', 'admin'], frontendPermissions: ['canPerformSdv', 'canSignForms'], assignableInUI: true, feature: 'Verify SDV' },
      { method: 'POST', path: '/api/sdv/bulk-verify', requiredRoles: ['monitor', 'admin'], frontendPermissions: ['canPerformSdv'], assignableInUI: true, feature: 'Bulk verify SDV' },
    ],
  },

  // ── VALIDATION RULES ──
  {
    routeFile: 'validation-rules.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/validation-rules', requiredRoles: [], frontendPermissions: ['canManageCompliance'], assignableInUI: true, feature: 'List validation rules' },
      { method: 'POST', path: '/api/validation-rules', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canManageCompliance'], assignableInUI: true, feature: 'Create validation rule' },
      { method: 'PUT', path: '/api/validation-rules/:ruleId', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canManageCompliance'], assignableInUI: true, feature: 'Update validation rule' },
      { method: 'DELETE', path: '/api/validation-rules/:ruleId', requiredRoles: ['admin'], frontendPermissions: ['canManageCompliance'], assignableInUI: true, feature: 'Delete validation rule' },
    ],
  },

  // ── AUDIT ──
  {
    routeFile: 'audit.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/audit', requiredRoles: [], frontendPermissions: ['canViewAuditLogs'], assignableInUI: true, feature: 'View audit trail' },
      { method: 'GET', path: '/api/audit/export', requiredRoles: ['admin', 'monitor'], frontendPermissions: ['canExportAuditLogs'], assignableInUI: true, feature: 'Export audit logs' },
    ],
  },

  // ── SITES ──
  {
    routeFile: 'site.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'GET', path: '/api/sites', requiredRoles: [], frontendPermissions: ['canViewStudies'], assignableInUI: true, feature: 'List sites' },
      { method: 'POST', path: '/api/sites', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canManageStudyPhases'], assignableInUI: true, feature: 'Create site' },
      { method: 'PUT', path: '/api/sites/:siteId', requiredRoles: ['admin', 'data_manager'], frontendPermissions: ['canManageStudyPhases'], assignableInUI: true, feature: 'Update site' },
    ],
  },

  // ── EXPORT (missing role enforcement) ──
  {
    routeFile: 'export.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'POST', path: '/api/export/execute', requiredRoles: [], frontendPermissions: ['canExportData', 'canExportPatientData'], assignableInUI: true, feature: 'Execute data export', notes: 'SECURITY GAP: no requireRole applied' },
    ],
  },

  // ── IMPORT (missing role enforcement) ──
  {
    routeFile: 'import.routes.ts',
    blanketRoles: [],
    routes: [
      { method: 'POST', path: '/api/import/execute', requiredRoles: [], frontendPermissions: [], assignableInUI: false, feature: 'Execute data import', notes: 'SECURITY GAP: no requireRole applied' },
    ],
  },
];

// ============================================================================
// ROLE → DEFAULT PERMISSION MAP (what each role gets out of the box)
// ============================================================================

export const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'canAccessDashboard', 'canViewOwnData', 'canViewAllData',
    'canViewPatients', 'canAddPatients', 'canEditPatients', 'canDeletePatients', 'canViewPatientPHI', 'canExportPatientData',
    'canViewStudies', 'canCreateStudies', 'canEditStudies', 'canDeleteStudies', 'canManageStudyPhases', 'canEnrollPatients',
    'canViewTemplates', 'canCreateTemplates', 'canEditTemplates', 'canDeleteTemplates', 'canPublishTemplates',
    'canFillForms', 'canEditForms', 'canSignForms', 'canLockForms',
    'canViewReports', 'canCreateReports', 'canExportReports', 'canViewAnalytics',
    'canViewAuditLogs', 'canExportAuditLogs', 'canManageCompliance',
    'canViewUsers', 'canCreateUsers', 'canEditUsers', 'canDeleteUsers', 'canManageRoles',
    'canAccessSystemSettings', 'canManageIntegrations', 'canPerformBackups',
    'canViewDataQueries', 'canCreateDataQueries', 'canResolveDataQueries',
  ],
  data_manager: [
    'canAccessDashboard', 'canViewOwnData', 'canViewAllData',
    'canViewPatients', 'canAddPatients', 'canEditPatients', 'canDeletePatients', 'canViewPatientPHI', 'canExportPatientData',
    'canViewStudies', 'canCreateStudies', 'canEditStudies', 'canManageStudyPhases', 'canEnrollPatients',
    'canViewTemplates', 'canCreateTemplates', 'canEditTemplates', 'canPublishTemplates',
    'canFillForms', 'canEditForms', 'canLockForms',
    'canViewReports', 'canCreateReports', 'canExportReports', 'canViewAnalytics',
    'canViewAuditLogs', 'canExportAuditLogs', 'canManageCompliance',
    'canViewUsers', 'canCreateUsers', 'canEditUsers', 'canManageRoles',
    'canViewDataQueries', 'canCreateDataQueries', 'canResolveDataQueries',
  ],
  investigator: [
    'canAccessDashboard', 'canViewOwnData', 'canViewAllData',
    'canViewPatients', 'canAddPatients', 'canEditPatients', 'canExportPatientData',
    'canViewStudies', 'canEnrollPatients',
    'canViewTemplates',
    'canFillForms', 'canEditForms', 'canSignForms',
    'canViewReports', 'canExportReports',
    'canViewDataQueries', 'canCreateDataQueries', 'canResolveDataQueries',
  ],
  coordinator: [
    'canAccessDashboard', 'canViewOwnData',
    'canViewPatients', 'canAddPatients', 'canEditPatients',
    'canViewStudies', 'canEnrollPatients',
    'canViewTemplates',
    'canFillForms', 'canEditForms',
    'canViewReports',
    'canViewDataQueries', 'canCreateDataQueries',
  ],
  monitor: [
    'canAccessDashboard', 'canViewOwnData', 'canViewAllData',
    'canViewPatients', 'canViewPatientPHI',
    'canViewStudies',
    'canViewTemplates',
    'canSignForms', 'canLockForms',
    'canViewReports', 'canExportReports',
    'canViewAuditLogs',
    'canViewDataQueries', 'canCreateDataQueries', 'canResolveDataQueries',
  ],
  viewer: [
    'canAccessDashboard', 'canViewOwnData',
    'canViewPatients',
    'canViewStudies',
    'canViewTemplates',
    'canViewReports',
    'canViewDataQueries',
  ],
};

// ============================================================================
// KNOWN SECURITY GAPS / INCONSISTENCIES
// ============================================================================

export const KNOWN_ISSUES = [
  {
    id: 'EXPORT_NO_ROLE',
    severity: 'HIGH',
    description: 'export.routes.ts imports requireRole but never applies it — any authenticated user can export data',
    fix: "Add requireRole('admin', 'data_manager', 'investigator') to export routes",
  },
  {
    id: 'IMPORT_NO_ROLE',
    severity: 'HIGH',
    description: 'import.routes.ts imports requireRole but never applies it — any authenticated user can import data',
    fix: "Add requireRole('admin', 'data_manager') to import routes",
  },
  {
    id: 'AE_NO_AUTH',
    severity: 'CRITICAL',
    description: 'ae.routes.ts has no authMiddleware at all — all adverse event routes are public',
    fix: 'Add router.use(authMiddleware) at the top of ae.routes.ts',
  },
  {
    id: 'BACKUP_NO_ROLE',
    severity: 'HIGH',
    description: 'backup.routes.ts comments say "Admin only" but no requireRole enforces it',
    fix: "Add requireRole('admin') to backup routes",
  },
  {
    id: 'SDV_INCONSISTENT',
    severity: 'MEDIUM',
    description: 'SDV verification gated inconsistently: sidebar uses canSignForms && !canEditForms, dashboard uses canSignForms, patient-form-modal uses canPerformSdv || hasAnyRole',
    fix: 'Unify SDV gating to use canPerformSdv consistently',
  },
  {
    id: 'PERMISSION_DIRECTIVES_UNUSED',
    severity: 'LOW',
    description: '*hasPermission and permissionDisabled directives are defined but not used in any production template',
    fix: 'Adopt directives in templates or remove dead code',
  },
];
