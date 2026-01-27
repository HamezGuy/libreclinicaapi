/**
 * Site/Location Routes
 * 
 * API endpoints for site management including:
 * - CRUD operations for sites
 * - Patient-to-site assignments
 * - Site staff management
 * - Site statistics
 * 
 * 21 CFR Part 11 Compliance:
 * - All site modifications require electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import express from 'express';
import * as controller from '../controllers/site.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// ============================================================================
// READ OPERATIONS - All authenticated users
// ============================================================================

// Get all sites for a study
router.get('/study/:studyId', controller.getSitesForStudy);

// Get site statistics for a study
router.get('/study/:studyId/stats', controller.getSiteStatistics);

// Get a single site by ID
router.get('/:id', controller.getSiteById);

// Get patients for a site
router.get('/:id/patients', controller.getSitePatients);

// Get staff for a site
router.get('/:id/staff', controller.getSiteStaff);

// ============================================================================
// WRITE OPERATIONS - Require admin/coordinator role + electronic signature
// ============================================================================

// Create a new site
router.post('/',
  requireRole('admin', 'coordinator'),
  requireSignatureFor(SignatureMeanings.SITE_CREATE || 'Site Creation'),
  controller.createSite
);

// Update a site
router.put('/:id',
  requireRole('admin', 'coordinator'),
  requireSignatureFor(SignatureMeanings.SITE_UPDATE || 'Site Update'),
  controller.updateSite
);

// Delete a site
router.delete('/:id',
  requireRole('admin'),
  requireSignatureFor(SignatureMeanings.SITE_DELETE || 'Site Deletion'),
  controller.deleteSite
);

// Transfer a patient to a different site
router.post('/transfer',
  requireRole('admin', 'coordinator'),
  requireSignatureFor(SignatureMeanings.SUBJECT_TRANSFER || 'Patient Transfer'),
  controller.transferPatient
);

// Assign staff to a site
router.post('/:id/staff',
  requireRole('admin', 'coordinator'),
  requireSignatureFor(SignatureMeanings.STAFF_ASSIGN || 'Staff Assignment'),
  controller.assignStaff
);

// Remove staff from a site
router.delete('/:id/staff/:username',
  requireRole('admin', 'coordinator'),
  requireSignatureFor(SignatureMeanings.STAFF_REMOVE || 'Staff Removal'),
  controller.removeStaff
);

export default router;

