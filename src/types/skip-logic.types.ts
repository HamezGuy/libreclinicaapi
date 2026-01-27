/**
 * Skip Logic Types
 * 
 * Advanced skip logic, branching rules, and form linking for EDC forms.
 * Supports:
 * - Field visibility conditions (show/hide based on other field values)
 * - Conditional required fields
 * - Form branching (link to other forms based on answers)
 * - Section show/hide
 * - Calculated field triggers
 * 
 * 21 CFR Part 11 §11.10(h) - Device checks (validation and logic rules)
 */

// ============================================================================
// SKIP LOGIC OPERATORS
// ============================================================================

export type SkipLogicOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'in_list'
  | 'not_in_list'
  | 'between'
  | 'not_between'
  | 'matches_regex'
  | 'is_true'
  | 'is_false'
  | 'date_before'
  | 'date_after'
  | 'date_between'
  | 'age_greater_than'
  | 'age_less_than';

export type LogicalOperator = 'AND' | 'OR';

// ============================================================================
// CONDITIONS
// ============================================================================

/**
 * A single condition in a skip logic rule
 */
export interface SkipLogicCondition {
  id?: string;
  fieldId: string;           // The source field to evaluate (by name or ID)
  fieldName?: string;        // Human-readable field name
  operator: SkipLogicOperator;
  value: any;                // Value(s) to compare against
  value2?: any;              // Second value for 'between' operators
  logicalOperator?: LogicalOperator;  // How to combine with next condition
}

/**
 * A group of conditions that can be nested
 */
export interface ConditionGroup {
  id?: string;
  conditions: SkipLogicCondition[];
  nestedGroups?: ConditionGroup[];  // For complex AND/OR nesting
  groupOperator: LogicalOperator;   // How conditions in this group combine
}

// ============================================================================
// SKIP LOGIC ACTIONS
// ============================================================================

export type SkipLogicActionType =
  | 'show'           // Show a field
  | 'hide'           // Hide a field
  | 'require'        // Make field required
  | 'optional'       // Make field optional
  | 'disable'        // Disable field input
  | 'enable'         // Enable field input
  | 'set_value'      // Set field to a specific value
  | 'clear_value'    // Clear field value
  | 'open_form'      // Open/link to another form
  | 'show_section'   // Show a section
  | 'hide_section'   // Hide a section
  | 'show_message'   // Display an alert/message
  | 'trigger_calculation'   // Trigger a calculation
  | 'create_query'   // Auto-create a data query
  | 'send_notification';  // Send email/notification

/**
 * Action to perform when conditions are met
 */
export interface SkipLogicAction {
  id?: string;
  type: SkipLogicActionType;
  targetFieldId?: string;    // Field to act on
  targetFieldName?: string;  // Human-readable name
  targetSectionId?: string;  // Section to show/hide
  targetFormId?: number;     // Form to link to / open
  targetFormName?: string;   // Human-readable form name
  value?: any;               // Value for set_value action
  message?: string;          // Message to display
  notificationRecipients?: string[];  // For send_notification
  queryType?: string;        // For create_query
  priority?: number;         // Action priority (lower = execute first)
}

// ============================================================================
// SKIP LOGIC RULES
// ============================================================================

/**
 * Complete skip logic rule combining conditions and actions
 */
export interface SkipLogicRule {
  id: string;
  name: string;
  description?: string;
  
  // Rule configuration
  enabled: boolean;
  priority: number;         // Lower number = higher priority
  
  // When conditions
  conditions: SkipLogicCondition[];
  conditionGroups?: ConditionGroup[];  // For complex logic
  
  // Then actions
  actions: SkipLogicAction[];
  
  // Else actions (when conditions are NOT met)
  elseActions?: SkipLogicAction[];
  
  // Scope
  crfId?: number;
  crfVersionId?: number;
  sectionId?: string;
  
  // Metadata
  createdAt?: Date;
  createdBy?: number;
  updatedAt?: Date;
  updatedBy?: number;
}

// ============================================================================
// FORM LINKING
// ============================================================================

/**
 * Form link definition - opens another form based on field value
 */
export interface FormLink {
  id: string;
  name: string;
  description?: string;
  
  // Source configuration
  sourceCrfId: number;
  sourceFieldId: string;
  sourceFieldName?: string;
  
  // Trigger conditions
  triggerConditions: SkipLogicCondition[];
  
  // Target form
  targetCrfId: number;
  targetCrfName?: string;
  targetCrfVersionId?: number;
  
  // Link behavior
  linkType: 'modal' | 'redirect' | 'new_tab' | 'embedded';
  required: boolean;         // Must the linked form be completed?
  autoOpen: boolean;         // Automatically open when conditions met?
  prefillFields?: FormLinkPrefill[];  // Fields to prefill in target form
  
  // Metadata
  enabled: boolean;
  createdAt?: Date;
  createdBy?: number;
}

/**
 * Prefill configuration for linked forms
 */
export interface FormLinkPrefill {
  sourceFieldId: string;
  targetFieldId: string;
  transformFunction?: string;  // Optional transformation
}

/**
 * Common trigger patterns for form linking
 */
export const COMMON_LINK_TRIGGERS = {
  YES_ANSWER: { operator: 'equals' as SkipLogicOperator, value: 'yes' },
  NO_ANSWER: { operator: 'equals' as SkipLogicOperator, value: 'no' },
  TRUE_ANSWER: { operator: 'is_true' as SkipLogicOperator, value: true },
  FALSE_ANSWER: { operator: 'is_false' as SkipLogicOperator, value: false },
  NOT_EMPTY: { operator: 'is_not_empty' as SkipLogicOperator, value: null },
  VALUE_SELECTED: (value: string) => ({ operator: 'equals' as SkipLogicOperator, value }),
  VALUE_IN_RANGE: (min: number, max: number) => ({ 
    operator: 'between' as SkipLogicOperator, 
    value: min, 
    value2: max 
  })
};

// ============================================================================
// FORM BRANCHING
// ============================================================================

/**
 * Form branching configuration - determines which forms to show based on answers
 */
export interface FormBranch {
  id: string;
  name: string;
  
  // Source
  sourceEventDefinitionId?: number;  // Study event
  sourceCrfId: number;
  
  // Branch conditions
  conditions: SkipLogicCondition[];
  
  // Target forms to show/require when conditions met
  targetForms: FormBranchTarget[];
  
  // Metadata
  enabled: boolean;
  priority: number;
}

export interface FormBranchTarget {
  crfId: number;
  crfName?: string;
  required: boolean;
  order: number;
}

// ============================================================================
// EVALUATION RESULT
// ============================================================================

export interface SkipLogicEvaluationResult {
  ruleId: string;
  conditionsMet: boolean;
  actionsToExecute: SkipLogicAction[];
  evaluatedAt: Date;
  evaluationDetails?: {
    conditionResults: { condition: SkipLogicCondition; result: boolean }[];
  };
}

export interface FieldVisibilityState {
  fieldId: string;
  visible: boolean;
  required: boolean;
  disabled: boolean;
  value?: any;
  linkedForms?: { formId: number; formName: string; autoOpen: boolean }[];
  message?: string;
  evaluatedAt: Date;
}

export interface FormBranchingResult {
  sourceFormId: number;
  branchId?: string;
  activeBranches: {
    targetFormId: number;
    targetFormName?: string;
    required: boolean;
    autoOpen: boolean;
  }[];
  evaluatedAt: Date;
}

// ============================================================================
// DATABASE SCHEMA INTERFACES
// ============================================================================

/**
 * Database row for skip_logic_rules table
 */
export interface SkipLogicRuleRow {
  rule_id: number;
  crf_id: number;
  crf_version_id?: number;
  name: string;
  description?: string;
  conditions_json: string;  // JSON string of SkipLogicCondition[]
  actions_json: string;     // JSON string of SkipLogicAction[]
  else_actions_json?: string;
  enabled: boolean;
  priority: number;
  date_created: Date;
  date_updated?: Date;
  owner_id: number;
  update_id?: number;
}

/**
 * Database row for form_links table
 */
export interface FormLinkRow {
  link_id: number;
  name: string;
  description?: string;
  source_crf_id: number;
  source_field_id: string;
  trigger_conditions_json: string;
  target_crf_id: number;
  target_crf_version_id?: number;
  link_type: string;
  required: boolean;
  auto_open: boolean;
  prefill_fields_json?: string;
  enabled: boolean;
  date_created: Date;
  date_updated?: Date;
  owner_id: number;
  update_id?: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateSkipLogicRuleRequest {
  crfId: number;
  crfVersionId?: number;
  name: string;
  description?: string;
  conditions: SkipLogicCondition[];
  actions: SkipLogicAction[];
  elseActions?: SkipLogicAction[];
  enabled?: boolean;
  priority?: number;
}

export interface UpdateSkipLogicRuleRequest {
  name?: string;
  description?: string;
  conditions?: SkipLogicCondition[];
  actions?: SkipLogicAction[];
  elseActions?: SkipLogicAction[];
  enabled?: boolean;
  priority?: number;
}

export interface CreateFormLinkRequest {
  name: string;
  description?: string;
  sourceCrfId: number;
  sourceFieldId: string;
  triggerConditions: SkipLogicCondition[];
  targetCrfId: number;
  targetCrfVersionId?: number;
  linkType?: 'modal' | 'redirect' | 'new_tab' | 'embedded';
  required?: boolean;
  autoOpen?: boolean;
  prefillFields?: FormLinkPrefill[];
}

export interface EvaluateSkipLogicRequest {
  crfId: number;
  formData: Record<string, any>;
  subjectId?: number;
  eventId?: number;
}

export interface EvaluateSkipLogicResponse {
  success: boolean;
  fieldStates: Record<string, FieldVisibilityState>;
  linkedForms: {
    fieldId: string;
    targetFormId: number;
    targetFormName: string;
    shouldOpen: boolean;
  }[];
  messages: { fieldId?: string; message: string; type: 'info' | 'warning' | 'error' }[];
}

