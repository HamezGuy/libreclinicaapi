/**
 * Skip Logic Routes
 * 
 * API endpoints for skip logic rules, form linking, and conditional field visibility.
 * 
 * Features:
 * - CRUD for skip logic rules
 * - CRUD for form links
 * - Skip logic evaluation endpoint
 * 
 * 21 CFR Part 11 Compliance:
 * - All modifications require authentication (§11.10(d))
 * - All changes logged to audit trail (§11.10(e))
 */

import express, { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as skipLogicService from '../services/database/skip-logic.service';
import { trackUserAction } from '../services/database/audit.service';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// ============================================================================
// SKIP LOGIC RULES
// ============================================================================

/**
 * GET /api/skip-logic/rules/:crfId
 * Get all skip logic rules for a CRF
 */
router.get('/rules/:crfId', asyncHandler(async (req: Request, res: Response) => {
  const crfId = parseInt(req.params.crfId);
  
  if (isNaN(crfId)) {
    res.status(400).json({ success: false, message: 'Invalid CRF ID' });
    return;
  }
  
  const rules = await skipLogicService.getSkipLogicRulesForCrf(crfId);
  
  res.json({
    success: true,
    data: rules,
    count: rules.length
  });
}));

/**
 * POST /api/skip-logic/rules
 * Create a new skip logic rule
 */
router.post('/rules', 
  requireRole('admin', 'coordinator'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { crfId, name, description, conditions, actions, elseActions, enabled, priority } = req.body;
    
    if (!crfId || !name || !conditions || !actions) {
      res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: crfId, name, conditions, actions' 
      });
      return;
    }
    
    const result = await skipLogicService.createSkipLogicRule({
      crfId,
      name,
      description,
      conditions,
      actions,
      elseActions,
      enabled,
      priority
    }, user.userId);
    
    if (result.success) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'SKIP_LOGIC_RULE_CREATED',
        entityType: 'skip_logic_rule',
        entityId: result.ruleId,
        details: `Created skip logic rule: ${name}`
      });
    }
    
    res.status(result.success ? 201 : 400).json(result);
  })
);

/**
 * PUT /api/skip-logic/rules/:ruleId
 * Update a skip logic rule
 */
router.put('/rules/:ruleId',
  requireRole('admin', 'coordinator'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const ruleId = parseInt(req.params.ruleId);
    
    if (isNaN(ruleId)) {
      res.status(400).json({ success: false, message: 'Invalid rule ID' });
      return;
    }
    
    const result = await skipLogicService.updateSkipLogicRule(ruleId, req.body, user.userId);
    
    if (result.success) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'SKIP_LOGIC_RULE_UPDATED',
        entityType: 'skip_logic_rule',
        entityId: ruleId,
        details: 'Updated skip logic rule'
      });
    }
    
    res.json(result);
  })
);

/**
 * DELETE /api/skip-logic/rules/:ruleId
 * Delete a skip logic rule
 */
router.delete('/rules/:ruleId',
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const ruleId = parseInt(req.params.ruleId);
    
    if (isNaN(ruleId)) {
      res.status(400).json({ success: false, message: 'Invalid rule ID' });
      return;
    }
    
    const result = await skipLogicService.deleteSkipLogicRule(ruleId, user.userId);
    
    if (result.success) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'SKIP_LOGIC_RULE_DELETED',
        entityType: 'skip_logic_rule',
        entityId: ruleId,
        details: 'Deleted skip logic rule'
      });
    }
    
    res.json(result);
  })
);

// ============================================================================
// FORM LINKS
// ============================================================================

/**
 * GET /api/skip-logic/form-links/:crfId
 * Get all form links for a source CRF
 */
router.get('/form-links/:crfId', asyncHandler(async (req: Request, res: Response) => {
  const crfId = parseInt(req.params.crfId);
  
  if (isNaN(crfId)) {
    res.status(400).json({ success: false, message: 'Invalid CRF ID' });
    return;
  }
  
  const links = await skipLogicService.getFormLinksForCrf(crfId);
  
  res.json({
    success: true,
    data: links,
    count: links.length
  });
}));

/**
 * GET /api/skip-logic/form-links/:crfId/field/:fieldId
 * Get form links for a specific field
 */
router.get('/form-links/:crfId/field/:fieldId', asyncHandler(async (req: Request, res: Response) => {
  const crfId = parseInt(req.params.crfId);
  const fieldId = req.params.fieldId;
  
  if (isNaN(crfId)) {
    res.status(400).json({ success: false, message: 'Invalid CRF ID' });
    return;
  }
  
  const links = await skipLogicService.getFormLinksForField(crfId, fieldId);
  
  res.json({
    success: true,
    data: links,
    count: links.length
  });
}));

/**
 * POST /api/skip-logic/form-links
 * Create a form link
 */
router.post('/form-links',
  requireRole('admin', 'coordinator'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { 
      name, description, sourceCrfId, sourceFieldId, 
      triggerConditions, targetCrfId, targetCrfVersionId,
      linkType, required, autoOpen, prefillFields 
    } = req.body;
    
    if (!name || !sourceCrfId || !sourceFieldId || !targetCrfId || !triggerConditions) {
      res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: name, sourceCrfId, sourceFieldId, targetCrfId, triggerConditions' 
      });
      return;
    }
    
    const result = await skipLogicService.createFormLink({
      name,
      description,
      sourceCrfId,
      sourceFieldId,
      triggerConditions,
      targetCrfId,
      targetCrfVersionId,
      linkType,
      required,
      autoOpen,
      prefillFields
    }, user.userId);
    
    if (result.success) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'FORM_LINK_CREATED',
        entityType: 'form_link',
        entityId: result.linkId,
        details: `Created form link: ${name} (${sourceCrfId} -> ${targetCrfId})`
      });
    }
    
    res.status(result.success ? 201 : 400).json(result);
  })
);

/**
 * DELETE /api/skip-logic/form-links/:linkId
 * Delete a form link
 */
router.delete('/form-links/:linkId',
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const linkId = parseInt(req.params.linkId);
    
    if (isNaN(linkId)) {
      res.status(400).json({ success: false, message: 'Invalid link ID' });
      return;
    }
    
    const result = await skipLogicService.deleteFormLink(linkId, user.userId);
    
    if (result.success) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'FORM_LINK_DELETED',
        entityType: 'form_link',
        entityId: linkId,
        details: 'Deleted form link'
      });
    }
    
    res.json(result);
  })
);

// ============================================================================
// EVALUATION
// ============================================================================

/**
 * POST /api/skip-logic/evaluate
 * Evaluate skip logic rules and form links for given form data
 */
router.post('/evaluate', asyncHandler(async (req: Request, res: Response) => {
  const { crfId, formData, subjectId, eventId, includeFormLinks } = req.body;
  
  if (!crfId || !formData) {
    res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: crfId, formData' 
    });
    return;
  }
  
  const result = await skipLogicService.evaluateSkipLogic(
    crfId,
    formData,
    { subjectId, eventId, includeFormLinks }
  );
  
  res.json(result);
}));

/**
 * GET /api/skip-logic/operators
 * Get available operators for UI
 */
router.get('/operators', asyncHandler(async (req: Request, res: Response) => {
  const operators = [
    { value: 'equals', label: 'Equals', description: 'Value exactly matches' },
    { value: 'not_equals', label: 'Not Equals', description: 'Value does not match' },
    { value: 'greater_than', label: 'Greater Than', description: 'Value is greater (numeric)' },
    { value: 'less_than', label: 'Less Than', description: 'Value is less (numeric)' },
    { value: 'greater_than_or_equal', label: 'Greater or Equal', description: 'Value is greater or equal' },
    { value: 'less_than_or_equal', label: 'Less or Equal', description: 'Value is less or equal' },
    { value: 'between', label: 'Between', description: 'Value is between two numbers' },
    { value: 'not_between', label: 'Not Between', description: 'Value is outside range' },
    { value: 'contains', label: 'Contains', description: 'Text contains substring' },
    { value: 'not_contains', label: 'Not Contains', description: 'Text does not contain' },
    { value: 'starts_with', label: 'Starts With', description: 'Text starts with' },
    { value: 'ends_with', label: 'Ends With', description: 'Text ends with' },
    { value: 'is_empty', label: 'Is Empty', description: 'Field has no value' },
    { value: 'is_not_empty', label: 'Is Not Empty', description: 'Field has a value' },
    { value: 'is_true', label: 'Is True/Yes', description: 'Boolean or Yes value' },
    { value: 'is_false', label: 'Is False/No', description: 'Boolean or No value' },
    { value: 'in_list', label: 'In List', description: 'Value is one of multiple options' },
    { value: 'not_in_list', label: 'Not In List', description: 'Value is not in list' },
    { value: 'matches_regex', label: 'Matches Pattern', description: 'Matches regular expression' },
    { value: 'date_before', label: 'Date Before', description: 'Date is before' },
    { value: 'date_after', label: 'Date After', description: 'Date is after' },
    { value: 'date_between', label: 'Date Between', description: 'Date is in range' },
    { value: 'age_greater_than', label: 'Age Greater Than', description: 'Calculated age is greater' },
    { value: 'age_less_than', label: 'Age Less Than', description: 'Calculated age is less' }
  ];
  
  res.json({ success: true, data: operators });
}));

/**
 * GET /api/skip-logic/actions
 * Get available actions for UI
 */
router.get('/actions', asyncHandler(async (req: Request, res: Response) => {
  const actions = [
    { value: 'show', label: 'Show Field', description: 'Make field visible' },
    { value: 'hide', label: 'Hide Field', description: 'Hide field from view' },
    { value: 'require', label: 'Make Required', description: 'Field becomes required' },
    { value: 'optional', label: 'Make Optional', description: 'Field becomes optional' },
    { value: 'disable', label: 'Disable', description: 'Disable field input' },
    { value: 'enable', label: 'Enable', description: 'Enable field input' },
    { value: 'set_value', label: 'Set Value', description: 'Set field to specific value' },
    { value: 'clear_value', label: 'Clear Value', description: 'Clear field value' },
    { value: 'open_form', label: 'Open Form', description: 'Link to and open another form' },
    { value: 'show_section', label: 'Show Section', description: 'Show a form section' },
    { value: 'hide_section', label: 'Hide Section', description: 'Hide a form section' },
    { value: 'show_message', label: 'Show Message', description: 'Display alert message' },
    { value: 'trigger_calculation', label: 'Trigger Calculation', description: 'Run a calculation' },
    { value: 'create_query', label: 'Create Query', description: 'Auto-create data query' }
  ];
  
  res.json({ success: true, data: actions });
}));

export default router;

