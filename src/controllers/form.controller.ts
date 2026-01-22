/**
 * Form Controller
 * 
 * Handles form/CRF operations with audit tracking
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as formService from '../services/hybrid/form.service';
import { trackDocumentAccess, trackUserAction } from '../services/database/audit.service';

export const saveData = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await formService.saveFormData(req.body, user.userId, user.username);

  // Track form save action
  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username,
      action: 'FORM_UPDATED',
      entityType: 'event_crf',
      entityId: req.body.eventCrfId || req.body.crfId,
      details: 'Form data saved'
    });
  }

  res.status(result.success ? 200 : 400).json(result);
});

export const getData = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;
  const user = (req as any).user;

  const result = await formService.getFormData(parseInt(eventCrfId));

  // Track form view
  if (user?.userId) {
    await trackDocumentAccess(
      user.userId,
      user.username || user.userName,
      'event_crf',
      parseInt(eventCrfId),
      undefined,
      'view'
    );
  }

  res.json({ success: true, data: result });
});

export const getMetadata = asyncHandler(async (req: Request, res: Response) => {
  const { crfId } = req.params;
  const user = (req as any).user;

  const result = await formService.getFormMetadata(parseInt(crfId));

  if (!result) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
  }

  // Track document access (21 CFR Part 11)
  if (user?.userId) {
    await trackDocumentAccess(
      user.userId,
      user.username || user.userName,
      'crf',
      parseInt(crfId),
      result.crf?.name,
      'view'
    );
  }

  res.json({ success: true, data: result });
});

export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;

  const result = await formService.getFormStatus(parseInt(eventCrfId));

  if (!result) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await formService.getAllForms();
  
  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await formService.getFormById(parseInt(id));

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

  const result = await formService.createForm(req.body, user.userId);

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_CREATED',
      entityType: 'crf',
      entityId: result.crfId,
      details: `Created form: ${req.body.name}`
    });
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
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_UPDATED',
      entityType: 'crf',
      entityId: parseInt(id),
      details: `Updated form: ${req.body.name || id}`
    });
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
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_ARCHIVED',
      entityType: 'crf',
      entityId: parseInt(id),
      details: `Archived form ID: ${id} (21 CFR Part 11 compliance - no permanent deletion)`
    });
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
  const result = await formService.getArchivedForms(parsedStudyId);

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
  const { fieldName, value, createQueries } = req.body;
  const user = (req as any).user;

  if (!fieldName) {
    res.status(400).json({ success: false, message: 'fieldName is required' });
    return;
  }

  const result = await formService.updateFieldData(
    parseInt(eventCrfId),
    fieldName,
    value,
    user.userId,
    { validateOnly: false, createQueries: createQueries === true }
  );

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FIELD_UPDATED',
      entityType: 'item_data',
      entityId: result.data?.itemDataId,
      details: `Updated field "${fieldName}" in form ${eventCrfId}`
    });
  }

  res.status(result.success ? 200 : 400).json(result);
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
  const { fieldName, value, createQueries } = req.body;
  const user = (req as any).user;

  if (!fieldName) {
    res.status(400).json({ success: false, message: 'fieldName is required' });
    return;
  }

  const result = await formService.updateFieldData(
    parseInt(eventCrfId),
    fieldName,
    value,
    user.userId,
    { validateOnly: true, createQueries: createQueries === true }
  );

  res.json(result);
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
  updateField, validateField
};

