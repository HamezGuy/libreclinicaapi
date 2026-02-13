/**
 * Unit Tests for Permission Service
 * Tests the à la carte permission override system
 */

import {
  AVAILABLE_PERMISSIONS,
  getAvailablePermissions,
} from '../../src/services/database/permission.service';

describe('Permission Service - Unit Tests', () => {

  // =========================================================================
  // AVAILABLE_PERMISSIONS validation
  // =========================================================================
  describe('AVAILABLE_PERMISSIONS', () => {
    it('should contain all expected permission categories', () => {
      const categories = new Set(AVAILABLE_PERMISSIONS.map(p => p.category));
      expect(categories.has('Study Management')).toBe(true);
      expect(categories.has('Template Management')).toBe(true);
      expect(categories.has('Patient Management')).toBe(true);
      expect(categories.has('Data Entry')).toBe(true);
      expect(categories.has('Monitoring')).toBe(true);
      expect(categories.has('Queries')).toBe(true);
      expect(categories.has('Data Export')).toBe(true);
      expect(categories.has('Administration')).toBe(true);
      expect(categories.has('General')).toBe(true);
    });

    it('should have unique permission keys', () => {
      const keys = AVAILABLE_PERMISSIONS.map(p => p.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should have non-empty labels for all permissions', () => {
      for (const perm of AVAILABLE_PERMISSIONS) {
        expect(perm.label.length).toBeGreaterThan(0);
        expect(perm.key.length).toBeGreaterThan(0);
        expect(perm.category.length).toBeGreaterThan(0);
      }
    });

    it('should have exactly 29 permission keys', () => {
      expect(AVAILABLE_PERMISSIONS.length).toBe(29);
    });

    it('should contain all study management permissions', () => {
      const keys = AVAILABLE_PERMISSIONS.map(p => p.key);
      expect(keys).toContain('canCreateStudy');
      expect(keys).toContain('canEditStudy');
      expect(keys).toContain('canDeleteStudy');
    });

    it('should contain all template permissions', () => {
      const keys = AVAILABLE_PERMISSIONS.map(p => p.key);
      expect(keys).toContain('canCreateTemplates');
      expect(keys).toContain('canEditTemplates');
      expect(keys).toContain('canDeleteTemplates');
      expect(keys).toContain('canPublishTemplates');
    });

    it('should contain all patient permissions', () => {
      const keys = AVAILABLE_PERMISSIONS.map(p => p.key);
      expect(keys).toContain('canViewPatients');
      expect(keys).toContain('canEnrollPatients');
      expect(keys).toContain('canEditPatients');
      expect(keys).toContain('canDeletePatients');
    });

    it('should contain all form permissions', () => {
      const keys = AVAILABLE_PERMISSIONS.map(p => p.key);
      expect(keys).toContain('canFillForms');
      expect(keys).toContain('canEditForms');
      expect(keys).toContain('canSignForms');
      expect(keys).toContain('canLockForms');
    });

    it('should contain all SDV/monitoring permissions', () => {
      const keys = AVAILABLE_PERMISSIONS.map(p => p.key);
      expect(keys).toContain('canViewSdv');
      expect(keys).toContain('canPerformSdv');
    });

    it('should contain all query permissions', () => {
      const keys = AVAILABLE_PERMISSIONS.map(p => p.key);
      expect(keys).toContain('canViewQueries');
      expect(keys).toContain('canCreateQueries');
      expect(keys).toContain('canRespondToQueries');
      expect(keys).toContain('canCloseQueries');
    });

    it('should contain all admin permissions', () => {
      const keys = AVAILABLE_PERMISSIONS.map(p => p.key);
      expect(keys).toContain('canManageUsers');
      expect(keys).toContain('canViewAuditLogs');
      expect(keys).toContain('canManageValidationRules');
      expect(keys).toContain('canManageDataLocks');
    });

    it('should have all keys starting with "can"', () => {
      for (const perm of AVAILABLE_PERMISSIONS) {
        expect(perm.key.startsWith('can')).toBe(true);
      }
    });
  });

  // =========================================================================
  // getAvailablePermissions
  // =========================================================================
  describe('getAvailablePermissions', () => {
    it('should return the same array as AVAILABLE_PERMISSIONS', () => {
      const result = getAvailablePermissions();
      expect(result).toBe(AVAILABLE_PERMISSIONS);
      expect(result.length).toBe(AVAILABLE_PERMISSIONS.length);
    });
  });
});
