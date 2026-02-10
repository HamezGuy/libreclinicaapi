/**
 * Validation Rules Controller
 * 
 * Manages validation rules for CRFs/forms
 * 21 CFR Part 11 §11.10(h) - Device checks (validation rules)
 */

import { Request, Response, NextFunction } from 'express';
import * as validationRulesService from '../services/database/validation-rules.service';
import { trackUserAction } from '../services/database/audit.service';
import { logger } from '../config/logger';
import { ApiResponse } from '../types';

/**
 * Get validation rules for a CRF
 */
export const getRulesForCrf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { crfId } = req.params;
    const caller = (req as any).user;

    const rules = await validationRulesService.getRulesForCrf(parseInt(crfId), caller?.userId);

    const response: ApiResponse = {
      success: true,
      data: rules
    };

    res.json(response);
  } catch (error) {
    logger.error('Get CRF validation rules error:', error);
    next(error);
  }
};

/**
 * Get validation rules for a study (all CRFs)
 */
export const getRulesForStudy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { studyId } = req.params;
    const caller = (req as any).user;

    const rules = await validationRulesService.getRulesForStudy(parseInt(studyId), caller?.userId);

    const response: ApiResponse = {
      success: true,
      data: rules
    };

    res.json(response);
  } catch (error) {
    logger.error('Get study validation rules error:', error);
    next(error);
  }
};

/**
 * Get a single validation rule
 */
export const getRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ruleId } = req.params;
    const caller = (req as any).user;

    const rule = await validationRulesService.getRuleById(parseInt(ruleId), caller?.userId);

    if (!rule) {
      res.status(404).json({ success: false, message: 'Rule not found' });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: rule
    };

    res.json(response);
  } catch (error) {
    logger.error('Get validation rule error:', error);
    next(error);
  }
};

/**
 * Create a new validation rule
 */
export const createRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    const ruleData = req.body;

    const result = await validationRulesService.createRule(ruleData, user.userId);

    if (result.success) {
      // Audit trail
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'VALIDATION_RULE_CREATED',
        entityType: 'validation_rule',
        entityId: result.ruleId,
        details: `Created validation rule: ${ruleData.name} for CRF ${ruleData.crfId}`
      });
    }

    res.status(result.success ? 201 : 400).json(result);
  } catch (error) {
    logger.error('Create validation rule error:', error);
    next(error);
  }
};

/**
 * Update a validation rule
 */
export const updateRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    const { ruleId } = req.params;
    const updates = req.body;

    const result = await validationRulesService.updateRule(parseInt(ruleId), updates, user.userId);

    if (result.success) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'VALIDATION_RULE_UPDATED',
        entityType: 'validation_rule',
        entityId: parseInt(ruleId),
        details: `Updated validation rule: ${updates.name || ruleId}`
      });
    }

    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error('Update validation rule error:', error);
    next(error);
  }
};

/**
 * Toggle validation rule active state
 */
export const toggleRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    const { ruleId } = req.params;
    const { active } = req.body;

    const result = await validationRulesService.toggleRule(parseInt(ruleId), active, user.userId);

    if (result.success) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: active ? 'VALIDATION_RULE_ACTIVATED' : 'VALIDATION_RULE_DEACTIVATED',
        entityType: 'validation_rule',
        entityId: parseInt(ruleId),
        details: `Rule ${active ? 'activated' : 'deactivated'}`
      });
    }

    res.json(result);
  } catch (error) {
    logger.error('Toggle validation rule error:', error);
    next(error);
  }
};

/**
 * Delete a validation rule
 */
export const deleteRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    const { ruleId } = req.params;

    const result = await validationRulesService.deleteRule(parseInt(ruleId), user.userId);

    if (result.success) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'VALIDATION_RULE_DELETED',
        entityType: 'validation_rule',
        entityId: parseInt(ruleId),
        details: `Deleted validation rule ID: ${ruleId}`
      });
    }

    res.json(result);
  } catch (error) {
    logger.error('Delete validation rule error:', error);
    next(error);
  }
};

/**
 * Validate form data against rules
 * 
 * Accepts options from query params OR request body:
 * - createQueries: If true, creates queries (discrepancy notes) for validation failures
 * - studyId: Required if createQueries is true
 * - subjectId: Optional, links query to subject
 * - eventCrfId: Optional, links query to event CRF
 * 
 * Request body can contain:
 * - formData: The actual form data to validate (if separate from other fields)
 * - Or: form fields directly in the body
 */
export const validateData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    const { crfId } = req.params;
    
    // Support options from both query params and body for flexibility
    const createQueriesQuery = req.query.createQueries;
    const createQueriesBody = req.body.createQueries;
    
    const options = {
      createQueries: createQueriesQuery === 'true' || createQueriesBody === true,
      studyId: req.body.studyId || (req.query.studyId ? parseInt(req.query.studyId as string) : undefined),
      subjectId: req.body.subjectId || (req.query.subjectId ? parseInt(req.query.subjectId as string) : undefined),
      eventCrfId: req.body.eventCrfId || (req.query.eventCrfId ? parseInt(req.query.eventCrfId as string) : undefined),
      userId: user?.userId
    };

    // Support formData as nested object or form fields directly in body
    const formData = req.body.formData || (() => {
      // Extract form fields by removing metadata fields
      const { createQueries, studyId, subjectId, eventCrfId, formData: _, ...fields } = req.body;
      return fields;
    })();

    const result = await validationRulesService.validateFormData(parseInt(crfId), formData, options);

    // Audit trail if queries were created
    if (result.queriesCreated && result.queriesCreated > 0) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'VALIDATION_QUERIES_CREATED',
        entityType: 'validation',
        entityId: parseInt(crfId),
        details: `Created ${result.queriesCreated} queries from validation failures`
      });
    }

    const response: ApiResponse = {
      success: true,
      data: result
    };

    res.json(response);
  } catch (error) {
    logger.error('Validate form data error:', error);
    next(error);
  }
};

/**
 * Test a single rule against test data
 */
export const testRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { rule, testValue, testData } = req.body;

    // Create a mock rule object
    const mockRule: validationRulesService.ValidationRule = {
      id: 0,
      crfId: 0,
      name: rule.name || 'Test Rule',
      description: '',
      ruleType: rule.ruleType,
      fieldPath: 'testField',
      severity: rule.severity || 'error',
      errorMessage: rule.errorMessage || 'Validation failed',
      active: true,
      minValue: rule.minValue,
      maxValue: rule.maxValue,
      pattern: rule.pattern,
      operator: rule.operator,
      compareFieldPath: rule.compareFieldPath,
      dateCreated: new Date(),
      createdBy: 0
    };

    // Build test data object
    const data = testData || { testField: testValue };
    if (!testData) {
      data.testField = testValue;
    }

    // Validate
    const result = await validationRulesService.validateFormData(0, {
      [rule.fieldPath || 'testField']: testValue,
      ...testData
    });

    // Since we're testing a single rule, manually check
    let valid = true;
    
    if (rule.ruleType === 'required') {
      valid = testValue !== null && testValue !== undefined && testValue !== '';
    } else if (rule.ruleType === 'range') {
      const numValue = Number(testValue);
      if (isNaN(numValue)) {
        valid = false;
      } else {
        if (rule.minValue !== undefined && numValue < rule.minValue) valid = false;
        if (rule.maxValue !== undefined && numValue > rule.maxValue) valid = false;
      }
    } else if (rule.ruleType === 'format' && rule.pattern) {
      try {
        const regex = new RegExp(rule.pattern);
        valid = regex.test(String(testValue));
      } catch {
        valid = true;
      }
    }

    res.json({
      success: true,
      data: {
        valid,
        message: valid ? 'Validation passed' : rule.errorMessage
      }
    });
  } catch (error) {
    logger.error('Test rule error:', error);
    next(error);
  }
};

/**
 * Get validation rules for an event_crf (form instance on a patient)
 * This ensures validation rules apply to ALL form copies, not just templates.
 */
export const getRulesForEventCrf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { eventCrfId } = req.params;
    const caller = (req as any).user;

    const rules = await validationRulesService.getRulesForEventCrf(parseInt(eventCrfId), caller?.userId);

    const response: ApiResponse = {
      success: true,
      data: rules
    };

    res.json(response);
  } catch (error) {
    logger.error('Get event_crf validation rules error:', error);
    next(error);
  }
};

/**
 * Validate an event_crf (form instance on a patient)
 * 
 * This endpoint validates all data in a form instance and optionally
 * creates queries (discrepancy notes) for validation failures.
 * 
 * Used for:
 * - Form submission validation
 * - Re-validation after data import
 * - Batch validation for data cleaning
 */
export const validateEventCrf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    const { eventCrfId } = req.params;
    const { createQueries } = req.body;

    const result = await validationRulesService.validateEventCrf(
      parseInt(eventCrfId),
      {
        createQueries: createQueries === true,
        userId: user?.userId
      }
    );

    // Audit trail if queries were created
    if (result.queriesCreated && result.queriesCreated > 0) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'VALIDATION_QUERIES_CREATED',
        entityType: 'event_crf',
        entityId: parseInt(eventCrfId),
        details: `Created ${result.queriesCreated} queries from validation failures`
      });
    }

    const response: ApiResponse = {
      success: true,
      data: result
    };

    res.json(response);
  } catch (error) {
    logger.error('Validate event_crf error:', error);
    next(error);
  }
};

/**
 * Validate a single field change
 * 
 * This endpoint provides real-time validation feedback when a user
 * changes a field value. It can optionally create queries for failures.
 * 
 * Request body:
 * - crfId: The CRF template ID
 * - fieldPath: The field being validated
 * - value: The new value
 * - allFormData: (Optional) All form data for cross-field validation
 * - createQueries: (Optional) Create query for validation failure
 * - eventCrfId: (Optional) The event_crf_id for form instance context
 * - itemDataId: (Optional) The item_data_id for precise query linking
 * - itemId: (Optional) The item_id for field matching
 * - operationType: (Optional) 'create' | 'update' | 'delete' - the type of CRUD operation
 * 
 * This endpoint is designed to be called on every field change to ensure
 * validation rules apply to ALL form copies (event_crf instances).
 */
export const validateFieldChange = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    const { 
      crfId, 
      fieldPath, 
      value, 
      allFormData = {},
      createQueries = false,
      eventCrfId,
      studyId,
      subjectId,
      itemDataId,
      itemId,
      operationType = 'update'
    } = req.body;

    if (!crfId || !fieldPath) {
      res.status(400).json({
        success: false,
        message: 'crfId and fieldPath are required'
      });
      return;
    }

    const result = await validationRulesService.validateFieldChange(
      parseInt(crfId),
      fieldPath,
      value,
      allFormData,
      {
        createQueries,
        studyId: studyId ? parseInt(studyId) : undefined,
        subjectId: subjectId ? parseInt(subjectId) : undefined,
        eventCrfId: eventCrfId ? parseInt(eventCrfId) : undefined,
        itemDataId: itemDataId ? parseInt(itemDataId) : undefined,
        itemId: itemId ? parseInt(itemId) : undefined,
        userId: user?.userId,
        operationType: operationType as 'create' | 'update' | 'delete'
      }
    );

    // Log audit event if queries were created
    if (result.queriesCreated && result.queriesCreated > 0) {
      await trackUserAction({
        userId: user.userId,
        username: user.username || user.userName,
        action: 'VALIDATION_QUERY_CREATED',
        entityType: 'validation',
        entityId: parseInt(crfId),
        details: `Created ${result.queriesCreated} validation query for field ${fieldPath} (${operationType})`
      });
    }

    const response: ApiResponse = {
      success: true,
      data: result
    };

    res.json(response);
  } catch (error) {
    logger.error('Validate field change error:', error);
    next(error);
  }
};

export default {
  getRulesForCrf,
  getRulesForStudy,
  getRulesForEventCrf,
  getRule,
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
  validateData,
  validateEventCrf,
  validateFieldChange,
  testRule
};

