/**
 * eCRF Template Bundle Types — Re-export from shared-types
 *
 * All template bundle types are defined in @accura-trial/shared-types.
 * This file exists for backward-compatible import paths.
 */
export {
  BUNDLE_FORMAT_VERSION,
  type TemplateBundleV1,
  type ExportedForm,
  type ExportedSection,
  type ExportedField,
  type ExportedCondition,
  type ExportedFieldValidationRule,
  type ExportedTableColumn,
  type ExportedTableRow,
  type ExportedInlineField,
  type ExportedCriteriaItem,
  type ExportedQuestionRow,
  type ExportedQuestionAnswerColumn,
  type ExportedEditCheck,
  type ExportedValidationRule,
  type ExportedFormLink,
  type ExportBundleRequest,
  type ImportBundleRequest,
  type ImportBundleResponse,
} from '@accura-trial/shared-types';
