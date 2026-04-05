/**
 * Form Controller
 * 
 * Handles form/CRF operations with audit tracking
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as formService from '../services/hybrid/form.service';
import * as templateBundleService from '../services/hybrid/template-bundle.service';
import { trackDocumentAccess, trackUserAction } from '../services/database/audit.service';

export const saveData = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await formService.saveFormData(req.body, user.userId, user.username || user.userName);

  if (result.success) {
    trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_UPDATED',
      entityType: 'event_crf',
      entityId: (result as any).eventCrfId || (result as any).data?.eventCrfId || req.body.eventCrfId || req.body.crfId,
      details: 'Form data saved'
    }).catch(() => {});
  }

  res.status(result.success ? 200 : 400).json(result);
});

export const getData = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;
  const parsedId = parseInt(eventCrfId, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    res.status(400).json({ success: false, message: 'eventCrfId must be a positive integer' });
    return;
  }
  const user = (req as any).user;

  const result = await formService.getFormData(parsedId);

  // result is { data: rows[], lockStatus: {} } — return 404 only if nothing came back at all
  if (!result) {
    res.status(404).json({ success: false, message: 'Form data not found' });
    return;
  }

  // Track form view (non-blocking)
  if (user?.userId) {
    trackDocumentAccess(
      user.userId,
      user.username || user.userName,
      'event_crf',
      parsedId,
      undefined,
      'view'
    ).catch(() => {}); // fire-and-forget, do not fail the response
  }

  res.json({ success: true, data: result });
});

export const getMetadata = asyncHandler(async (req: Request, res: Response) => {
  const { crfId } = req.params;
  const parsedId = parseInt(crfId, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    res.status(400).json({ success: false, message: 'crfId must be a positive integer' });
    return;
  }
  const user = (req as any).user;

  const result = await formService.getFormMetadata(parsedId);

  if (!result) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
  }

  // Track document access (21 CFR Part 11) — non-blocking
  if (user?.userId) {
    trackDocumentAccess(
      user.userId,
      user.username || user.userName,
      'crf',
      parsedId,
      result.crf?.name,
      'view'
    ).catch(() => {});
  }

  res.json({ success: true, data: result });
});

export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;
  const parsedId = parseInt(eventCrfId, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    res.status(400).json({ success: false, message: 'eventCrfId must be a positive integer' });
    return;
  }

  const result = await formService.getFormStatus(parsedId);

  if (!result) {
    res.status(404).json({ success: false, message: 'Form instance not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  console.log(`[form.controller.list] Listing forms for userId=${user?.userId}`);
  const result = await formService.getAllForms(user?.userId);
  console.log(`[form.controller.list] Returning ${result.length} forms`);
  
  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const result = await formService.getFormById(parseInt(id), user?.userId);

  if (!result) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const getByStudy = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await formService.getStudyForms(parseInt(studyId as string));

  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

/**
 * Create a new form template (CRF)
 */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  console.log(`[form.controller.create] Starting form creation for user=${user.userId}, name="${req.body.name}"`);

  const result = await formService.createForm(req.body, user.userId);
  console.log(`[form.controller.create] createForm returned:`, { success: result.success, crfId: result.crfId, message: result.message });

  if (result.success) {
    trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_CREATED',
      entityType: 'crf',
      entityId: result.crfId,
      details: `Created form: ${req.body.name}`
    }).catch(err => console.error('[form.controller.create] Audit tracking failed (non-blocking):', err));
    console.log(`[form.controller.create] Audit tracked, returning 201 with crfId=${result.crfId}`);
  }

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Update a form template
 */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const result = await formService.updateForm(parseInt(id), req.body, user.userId);

  if (result.success) {
    trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_UPDATED',
      entityType: 'crf',
      entityId: parseInt(id),
      details: `Updated form: ${req.body.name || id}`
    }).catch(err => console.error('[form.controller.update] Audit tracking failed (non-blocking):', err));
  }

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Delete a form template
 * NOTE: For 21 CFR Part 11 compliance, this now archives instead of deletes
 */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  // For 21 CFR Part 11 compliance, delete now archives the form
  const result = await formService.archiveForm(parseInt(id), user.userId, 'Archived via delete operation');

  if (result.success) {
    trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_ARCHIVED',
      entityType: 'crf',
      entityId: parseInt(id),
      details: `Archived form ID: ${id} (21 CFR Part 11 compliance - no permanent deletion)`
    }).catch(err => console.error('[form.controller.remove] Audit tracking failed (non-blocking):', err));
  }

  res.status(result.success ? 200 : 400).json(result);
});

// =============================================================================
// 21 CFR PART 11 ARCHIVE OPERATIONS
// =============================================================================

/**
 * Archive a form template (21 CFR Part 11 compliant)
 * Archived forms are hidden from regular users but can be viewed/restored by admins
 */
export const archive = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;
  const { reason } = req.body;

  const result = await formService.archiveForm(parseInt(id), user.userId, reason);

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_ARCHIVED',
      entityType: 'crf',
      entityId: parseInt(id),
      details: `Archived form ID: ${id}. Reason: ${reason || 'Not specified'}`
    });
  }

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Restore an archived form (admin only)
 * 21 CFR Part 11 compliant - maintains full audit trail
 */
export const restore = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;
  const { reason } = req.body;

  const result = await formService.restoreForm(parseInt(id), user.userId, reason);

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_RESTORED',
      entityType: 'crf',
      entityId: parseInt(id),
      details: `Restored form ID: ${id} from archive. Reason: ${reason || 'Not specified'}`
    });
  }

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Get all archived forms (admin only)
 * 21 CFR Part 11 compliant - provides visibility to archived records
 */
export const getArchivedForms = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;
  const user = (req as any).user;

  const parsedStudyId = studyId ? parseInt(studyId as string) : undefined;
  const result = await formService.getArchivedForms(parsedStudyId, user?.userId);

  // Track admin access to archived forms
  await trackDocumentAccess(
    user.userId,
    user.username || user.userName,
    'archived_forms',
    0,
    'Archived Forms List',
    'view'
  );

  res.json({ 
    success: true, 
    data: result,
    total: result.length,
    message: '21 CFR Part 11 compliant archived forms list'
  });
});

// =============================================================================
// TEMPLATE FORKING / VERSIONING CONTROLLERS
// =============================================================================

/**
 * Get all versions of a form template
 */
export const getVersions = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const result = await formService.getFormVersions(parseInt(id));

  // Track access for audit (21 CFR Part 11)
  if (user?.userId && result.success) {
    await trackDocumentAccess(
      user.userId,
      user.username || user.userName,
      'crf_version_history',
      parseInt(id),
      undefined,
      'view'
    );
  }

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Create a new version of an existing form template
 * This is "forking" at the version level - same CRF, new version
 */
export const createVersion = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const { versionName, revisionNotes, copyFromVersionId } = req.body;

  if (!versionName) {
    res.status(400).json({ success: false, message: 'versionName is required' });
    return;
  }

  const result = await formService.createFormVersion(
    parseInt(id),
    { versionName, revisionNotes, copyFromVersionId },
    user.userId
  );

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_VERSION_CREATED',
      entityType: 'crf_version',
      entityId: result.crfVersionId,
      details: `Created version "${versionName}" for form ID: ${id}`
    });
  }

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Fork (copy) an entire form template to create a new independent form
 * This is "forking" at the CRF level - completely new CRF
 */
export const fork = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const { newName, description, targetStudyId } = req.body;

  if (!newName) {
    res.status(400).json({ success: false, message: 'newName is required' });
    return;
  }

  const result = await formService.forkForm(
    parseInt(id),
    { newName, description, targetStudyId },
    user.userId
  );

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_FORKED',
      entityType: 'crf',
      entityId: result.newCrfId,
      details: `Forked form ID ${id} as "${newName}"`
    });
  }

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Update a single field value with validation
 * 
 * PATCH /forms/field/:eventCrfId
 * Body: { fieldName, value, createQueries? }
 * 
 * This endpoint:
 * 1. Validates the field value against all applicable rules
 * 2. Creates queries for validation failures (if createQueries=true)
 * 3. Updates the field data
 * 4. Logs to audit trail
 */
export const updateField = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;
  const parsedId = parseInt(eventCrfId, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    res.status(400).json({ success: false, message: 'eventCrfId must be a positive integer' });
    return;
  }
  const { fieldName, value, createQueries } = req.body;
  const user = (req as any).user;

  // fieldName is validated by Joi middleware — but double-check here for safety
  if (!fieldName || typeof fieldName !== 'string') {
    res.status(400).json({ success: false, message: 'fieldName must be a non-empty string' });
    return;
  }

  const result = await formService.updateFieldData(
    parsedId,
    fieldName,
    value,
    user.userId,
    { validateOnly: false, createQueries: createQueries === true }
  );

  // Return appropriate HTTP status based on error type
  let status = 200;
  if (!result.success) {
    if (result.message?.includes('not found')) status = 404;
    else if (result.errors?.includes('RECORD_LOCKED')) status = 403;
    else status = 400;
  }

  if (result.success) {
    trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FIELD_UPDATED',
      entityType: 'item_data',
      entityId: result.data?.itemDataId,
      details: `Updated field "${fieldName}" in form ${parsedId}`
    }).catch(() => {});
  }

  res.status(status).json(result);
});

/**
 * Validate a single field value without updating
 * 
 * POST /forms/validate-field/:eventCrfId
 * Body: { fieldName, value, createQueries? }
 * 
 * This endpoint provides real-time validation feedback
 * without persisting the value. Used for:
 * - Field blur validation
 * - Pre-submission validation check
 */
export const validateField = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;
  const parsedId = parseInt(eventCrfId, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    res.status(400).json({ success: false, message: 'eventCrfId must be a positive integer' });
    return;
  }
  const { fieldName, value, createQueries } = req.body;
  const user = (req as any).user;

  // fieldName validated by Joi middleware; double-guard here
  if (!fieldName || typeof fieldName !== 'string') {
    res.status(400).json({ success: false, message: 'fieldName must be a non-empty string' });
    return;
  }

  const result = await formService.updateFieldData(
    parsedId,
    fieldName,
    value,
    user.userId,
    { validateOnly: true, createQueries: createQueries === true }
  );

  res.json(result);
});

// Reference data endpoints
export const getNullValueTypes = asyncHandler(async (req: Request, res: Response) => {
  const data = await formService.getNullValueTypes();
  res.json({ success: true, data });
});

export const getMeasurementUnits = asyncHandler(async (req: Request, res: Response) => {
  const data = await formService.getMeasurementUnits();
  res.json({ success: true, data });
});

/**
 * Mark a form instance as data-entry complete.
 * POST /api/forms/:eventCrfId/complete
 *
 * Sets completion_status_id=4 and status_id=2 (data complete).
 * This is a prerequisite for freezing and locking the form.
 */
export const markComplete = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const eventCrfId = parseInt(req.params.eventCrfId, 10);

  if (isNaN(eventCrfId) || eventCrfId <= 0) {
    res.status(400).json({ success: false, message: 'eventCrfId must be a positive integer' });
    return;
  }

  // markFormComplete throws on failure — asyncHandler converts to HTTP error
  const result = await formService.markFormComplete(eventCrfId, user.userId);

  await trackUserAction({
    userId: user.userId,
    username: user.username,
    action: 'FORM_COMPLETED',
    entityType: 'event_crf',
    entityId: eventCrfId,
    details: 'Form marked as data-entry complete'
  });

  res.json(result);
});

// ============================================================================
// TEMPLATE BUNDLE EXPORT/IMPORT
// ============================================================================

export const exportBundle = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { crfIds } = req.body;

  if (!Array.isArray(crfIds) || crfIds.length === 0) {
    res.status(400).json({ success: false, message: 'crfIds must be a non-empty array of CRF IDs' });
    return;
  }

  const bundle = await templateBundleService.exportBundle(
    crfIds.map((id: any) => parseInt(id)),
    user.username || user.userName || 'unknown'
  );

  trackUserAction({
    userId: user.userId,
    username: user.username || user.userName,
    action: 'TEMPLATE_BUNDLE_EXPORTED',
    entityType: 'crf',
    entityId: crfIds[0],
    details: `Exported ${bundle.forms.length} form(s) as template bundle`
  }).catch(() => {});

  res.json({ success: true, data: bundle });
});

export const importBundle = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { bundle, targetStudyId } = req.body;

  if (!bundle || !targetStudyId) {
    res.status(400).json({ success: false, message: 'bundle and targetStudyId are required' });
    return;
  }

  const result = await templateBundleService.importBundle(
    bundle,
    parseInt(targetStudyId),
    user.userId
  );

  if (result.success) {
    trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'TEMPLATE_BUNDLE_IMPORTED',
      entityType: 'study',
      entityId: targetStudyId,
      details: `Imported ${result.createdForms.length} form(s) from template bundle`
    }).catch(() => {});
  }

  res.status(result.success ? 201 : 400).json(result);
});

export default { 
  saveData, getData, getMetadata, getStatus, 
  list, get, getByStudy, 
  create, update, remove,
  // 21 CFR Part 11 Archive Operations
  archive, restore, getArchivedForms,
  // Forking/Versioning
  getVersions, createVersion, fork,
  // Field-level operations with validation
  updateField, validateField,
  // Mark form complete (prerequisite for data lock)
  markComplete,
  // Reference data
  getNullValueTypes, getMeasurementUnits,
  // Template bundle export/import
  exportBundle, importBundle
};

