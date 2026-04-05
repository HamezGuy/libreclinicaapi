/**
 * eCRF Template Bundle Types
 *
 * Defines the portable interchange format for exporting/importing form templates
 * across studies. All internal cross-references use stable field/form **names**
 * (refKeys) instead of database IDs so the bundle is self-contained and can be
 * imported into any study regardless of the target ID space.
 *
 * File extension: .ecrftemplate (JSON)
 */

// =============================================================================
// TOP-LEVEL BUNDLE
// =============================================================================

export const BUNDLE_FORMAT_VERSION = '1.0';

export interface TemplateBundleV1 {
  formatVersion: typeof BUNDLE_FORMAT_VERSION;
  exportedAt: string;
  exportedBy: string;
  sourceStudyName?: string;
  forms: ExportedForm[];
}

// =============================================================================
// EXPORTED FORM
// =============================================================================

export interface ExportedForm {
  refKey: string;
  name: string;
  description?: string;
  category?: string;
  version?: string;
  sections: ExportedSection[];
  fields: ExportedField[];
  editChecks: ExportedEditCheck[];
  validationRuleRecords: ExportedValidationRule[];
  formLinks: ExportedFormLink[];
}

export interface ExportedSection {
  id: string;
  name: string;
  description?: string;
  order: number;
}

// =============================================================================
// EXPORTED FIELD
// =============================================================================

/**
 * Portable field definition. All ID-based cross-references have been replaced
 * with name-based `*Ref` properties that index into the same bundle.
 */
export interface ExportedField {
  refKey: string;
  name: string;
  label?: string;
  type?: string;
  placeholder?: string;
  helpText?: string;
  description?: string;
  required?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  defaultValue?: any;
  options?: { label: string; value: string; order?: number }[];

  validationRules?: ExportedFieldValidationRule[];
  unit?: string;
  min?: number;
  max?: number;
  format?: string;

  isPhiField?: boolean;
  phiClassification?: string;
  auditRequired?: boolean;
  criticalDataPoint?: boolean;
  signatureRequired?: boolean;
  sdvRequired?: boolean;

  showWhen?: ExportedCondition[];
  hideWhen?: ExportedCondition[];
  requiredWhen?: ExportedCondition[];

  calculationFormula?: string;
  /** Field name refs (not IDs) for calculation dependencies */
  dependsOnRefs?: string[];
  calculationType?: 'field' | 'group';

  allowedFileTypes?: string[];
  maxFileSize?: number;
  maxFiles?: number;
  barcodeFormat?: string;

  tableColumns?: ExportedTableColumn[];
  tableRows?: ExportedTableRow[];
  tableSettings?: Record<string, any>;

  inlineFields?: ExportedInlineField[];
  inlineGroupSettings?: Record<string, any>;

  criteriaItems?: ExportedCriteriaItem[];
  criteriaListSettings?: Record<string, any>;

  questionRows?: ExportedQuestionRow[];
  questionTableSettings?: Record<string, any>;

  staticContent?: string;
  headerLevel?: 1 | 2 | 3 | 4;

  /** Cross-form link legacy shorthand (name-based) */
  linkedFormRef?: string;
  linkedFormTriggerValue?: any;
  linkedFormRequired?: boolean;

  width?: string;
  columnPosition?: number | string;
  columnSpan?: number;
  columnNumber?: number;
  order?: number;
  ordinal?: number;
  section?: string;
  group?: string;
  groupId?: string;
}

// =============================================================================
// PORTABLE CONDITION (replaces ShowWhenCondition with name-based refs)
// =============================================================================

export interface ExportedCondition {
  fieldRef: string;
  operator: string;
  value?: any;
  value2?: any;
  message?: string;
  logicalOperator?: 'AND' | 'OR';
}

// =============================================================================
// SUB-FIELD TYPES
// =============================================================================

export interface ExportedFieldValidationRule {
  type: string;
  value?: any;
  message?: string;
}

export interface ExportedTableColumn {
  id: string;
  name: string;
  label: string;
  type: string;
  width?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  readonly?: boolean;
  defaultValue?: string;
}

export interface ExportedTableRow {
  id: string;
  label: string;
}

export interface ExportedInlineField {
  id: string;
  label: string;
  type: string;
  width?: string;
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  unit?: string;
  min?: number;
  max?: number;
}

export interface ExportedCriteriaItem {
  id: string;
  number?: number;
  text: string;
  responseType: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  failValue?: string;
  helpText?: string;
}

export interface ExportedQuestionRow {
  id: string;
  question: string;
  answerColumns: ExportedQuestionAnswerColumn[];
}

export interface ExportedQuestionAnswerColumn {
  id: string;
  type: string;
  header?: string;
  width?: string;
  required?: boolean;
  readonly?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  defaultValue?: string;
}

// =============================================================================
// EDIT CHECKS (name-based refs)
// =============================================================================

export interface ExportedEditCheck {
  name: string;
  description?: string;
  sourceFieldRef: string;
  targetFieldRef?: string;
  operator: string;
  value?: any;
  value2?: any;
  customFormula?: string;
  errorMessage: string;
  severity: 'error' | 'warning' | 'info';
  isActive: boolean;
  requiresQuery?: boolean;
}

// =============================================================================
// VALIDATION RULES (name-based refs)
// =============================================================================

export interface ExportedValidationRule {
  name?: string;
  description?: string;
  fieldRef: string;
  ruleType: string;
  severity: 'error' | 'warning';
  errorMessage: string;
  warningMessage?: string;
  active: boolean;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  formatType?: string;
  operator?: string;
  compareFieldRef?: string;
  compareValue?: string;
  customExpression?: string;
  bpSystolicMin?: number;
  bpSystolicMax?: number;
  bpDiastolicMin?: number;
  bpDiastolicMax?: number;
  tableCellTarget?: Record<string, any> | null;
}

// =============================================================================
// FORM LINKS (name-based refs)
// =============================================================================

export interface ExportedFormLink {
  name: string;
  description?: string;
  sourceFieldRef: string;
  /** refKey of the target form within this bundle */
  targetFormRef: string;
  triggerConditions: ExportedCondition[];
  linkType: string;
  required: boolean;
  autoOpen: boolean;
  prefillFields?: { sourceFieldRef: string; targetFieldRef: string }[];
  enabled?: boolean;
}

// =============================================================================
// API REQUEST / RESPONSE SHAPES
// =============================================================================

export interface ExportBundleRequest {
  crfIds: number[];
  password?: string;
}

export interface ImportBundleRequest {
  bundle: TemplateBundleV1;
  targetStudyId: number;
  password?: string;
}

export interface ImportBundleResponse {
  success: boolean;
  createdForms: { refKey: string; newCrfId: number; newCrfVersionId: number }[];
  warnings: string[];
  message?: string;
}
