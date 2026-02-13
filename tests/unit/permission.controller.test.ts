/**
 * Unit Tests for Permission Controller and Routes
 * Tests the à la carte permission API endpoints
 */

import {
  AVAILABLE_PERMISSIONS,
  getAvailablePermissions,
} from '../../src/services/database/permission.service';

describe('Permission Controller Logic - Unit Tests', () => {

  // =========================================================================
  // Available permissions endpoint response shape
  // =========================================================================
  describe('GET /api/permissions/available response', () => {
    it('should group permissions by category correctly', () => {
      const permissions = getAvailablePermissions();
      const grouped: Record<string, { key: string; label: string }[]> = {};
      for (const perm of permissions) {
        if (!grouped[perm.category]) grouped[perm.category] = [];
        grouped[perm.category].push({ key: perm.key, label: perm.label });
      }

      // Verify grouping is correct
      expect(Object.keys(grouped).length).toBeGreaterThanOrEqual(9);
      expect(grouped['Study Management'].length).toBe(3);
      expect(grouped['Template Management'].length).toBe(4);
      expect(grouped['Patient Management'].length).toBe(4);
      expect(grouped['Data Entry'].length).toBe(4);
      expect(grouped['Monitoring'].length).toBe(2);
      expect(grouped['Queries'].length).toBe(4);
      expect(grouped['Data Export'].length).toBe(2);
      expect(grouped['Administration'].length).toBe(4);
      expect(grouped['General'].length).toBe(2);
    });

    it('should have correct total count of permissions', () => {
      const permissions = getAvailablePermissions();
      // 3 + 4 + 4 + 4 + 2 + 4 + 2 + 4 + 2 = 29
      // Actually let's count: Study(3) + Template(4) + Patient(4) + DataEntry(4) + Monitoring(2) + Queries(4) + Export(2) + Admin(4) + General(2) = 29
      expect(permissions.length).toBe(29);
    });
  });

  // =========================================================================
  // Permission key validation
  // =========================================================================
  describe('Permission key validation', () => {
    it('all keys should match UserPermissions interface keys', () => {
      // These are the exact keys from UserPermissions in libreclinica-auth.service.ts
      const userPermissionKeys = [
        'canCreateStudy', 'canEditStudy', 'canDeleteStudy',
        'canCreateTemplates', 'canEditTemplates', 'canDeleteTemplates', 'canPublishTemplates',
        'canViewPatients', 'canEnrollPatients', 'canEditPatients', 'canDeletePatients',
        'canFillForms', 'canEditForms', 'canSignForms', 'canLockForms',
        'canViewSdv', 'canPerformSdv',
        'canViewQueries', 'canCreateQueries', 'canRespondToQueries', 'canCloseQueries',
        'canExportData', 'canViewReports',
        'canManageUsers', 'canViewAuditLogs', 'canManageValidationRules', 'canManageDataLocks',
        'canViewAllData', 'canApproveChanges'
      ];

      const availableKeys = AVAILABLE_PERMISSIONS.map(p => p.key);

      // Every AVAILABLE_PERMISSIONS key should be a valid UserPermissions key
      for (const key of availableKeys) {
        expect(userPermissionKeys).withContext(`${key} should be in UserPermissions`).toContain(key);
      }

      // Every UserPermissions key should be in AVAILABLE_PERMISSIONS
      for (const key of userPermissionKeys) {
        expect(availableKeys).withContext(`${key} should be in AVAILABLE_PERMISSIONS`).toContain(key);
      }
    });
  });

  // =========================================================================
  // Category ordering and completeness
  // =========================================================================
  describe('Category completeness', () => {
    it('Study Management should have create, edit, delete', () => {
      const studyPerms = AVAILABLE_PERMISSIONS.filter(p => p.category === 'Study Management');
      const keys = studyPerms.map(p => p.key);
      expect(keys).toContain('canCreateStudy');
      expect(keys).toContain('canEditStudy');
      expect(keys).toContain('canDeleteStudy');
    });

    it('Data Entry should have fill, edit, sign, lock', () => {
      const formPerms = AVAILABLE_PERMISSIONS.filter(p => p.category === 'Data Entry');
      const keys = formPerms.map(p => p.key);
      expect(keys).toContain('canFillForms');
      expect(keys).toContain('canEditForms');
      expect(keys).toContain('canSignForms');
      expect(keys).toContain('canLockForms');
    });

    it('Administration should have manage users, audit, validation, data locks', () => {
      const adminPerms = AVAILABLE_PERMISSIONS.filter(p => p.category === 'Administration');
      const keys = adminPerms.map(p => p.key);
      expect(keys).toContain('canManageUsers');
      expect(keys).toContain('canViewAuditLogs');
      expect(keys).toContain('canManageValidationRules');
      expect(keys).toContain('canManageDataLocks');
    });
  });
});
