/**
 * AI Rule Validator — Gates 2-4 of the AI rule-compiler.
 *
 * The provider gives us raw `SuggestedRule[]`. This module enforces
 * everything the type system can't: field whitelisting, formatType
 * registry membership, regex sandbox compile, self-test execution
 * against the canonical evaluator. Anything that fails is either
 * STRIPPED with a warning or sent back to the LLM for one retry
 * (regex/self-test failures only — see `splitForRetry`).
 *
 * Design constraints:
 *   - The validator MUST be deterministic. Calling twice with the same
 *     input gives the same accepted/rejected partition.
 *   - The validator MUST NOT mutate its inputs.
 *   - The validator MUST use the same canonical evaluator as the runtime
 *     (`testRuleDirectly` from validation-rules.service). This is what
 *     guarantees the AI's self-test results match what the patient form
 *     will see.
 *
 * 2026-04 audit notes: this is the implementation of Gates 2-4 from
 * AI_VALIDATION_RULE_COMPILER.md §5. Gate 1 ("prefer registry") is
 * encoded in the prompt; Gate 3 (re2 sandbox) lives in regex-sandbox.ts.
 */

import { logger } from '../../config/logger';
import {
  testRuleDirectly,
  FORMAT_TYPE_REGISTRY,
} from '../database/validation-rules.service';
import { ValidationRule as RuntimeValidationRule } from '@accura-trial/shared-types';
import {
  FieldContextEntry,
  SuggestedRule,
  SuggestedRuleType,
} from './types';
import { safeCompile, safeTest, getRe2LoadStatus } from './regex-sandbox.service';

const ALLOWED_RULE_TYPES = new Set<SuggestedRuleType>([
  'required', 'range', 'format', 'consistency', 'value_match', 'pattern_match', 'formula',
]);

/**
 * 2026-04 ISSUE-001 hardening: these rule types execute hot-formula-parser
 * or (historically) `new Function(...)`. AI must never emit them.
 * Defended at four layers:
 *   1) prompt instruction
 *   2) JSON schema enum
 *   3) `SuggestedRuleType` TypeScript union
 *   4) THIS runtime check
 */
const FORBIDDEN_RULE_TYPES = new Set<string>([
  'business_logic', 'cross_form',
]);

/** Always strip these fields even if present. */
const ALWAYS_STRIP_FIELDS: string[] = [];

/**
 * The full set of properties a SuggestedRule may carry. Anything not in
 * here is dropped before the rule reaches persistence. This is a
 * defense-in-depth gate for two attack shapes:
 *   1) An LLM that ignores `additionalProperties: false` in the schema.
 *   2) A future provider that adds a vendor-specific debug field.
 *
 * KEEP IN SYNC with `SuggestedRule` in ./types.ts.
 */
const ALLOWED_RULE_PROPERTIES = new Set<string>([
  'name', 'description',
  'ruleType', 'fieldPath', 'itemId',
  'severity', 'errorMessage', 'warningMessage',
  'minValue', 'maxValue',
  'pattern', 'formatType',
  'operator', 'compareFieldPath', 'compareValue',
  'customExpression',
  'bpSystolicMin', 'bpSystolicMax', 'bpDiastolicMin', 'bpDiastolicMax',
  'tableCellTarget',  // tracked here only so the strip loop sees it; the
                      // separate stripping step below removes it.
  'rationale',
  'selfTest',
  'providerWarning',
]);

/**
 * Operators the runtime evaluator (`compareValues` in
 * `validation-rules.service.ts`) actually parses. Anything outside this
 * set falls into the `default: return true` arm, i.e. the rule silently
 * never fires. Keep in sync with the prompt's OPERATOR VOCABULARY
 * section AND the `operator.enum` in `prompts/rule-compiler.schema.json`.
 *
 * Categories:
 *   - Generic (auto-coerces numbers / times / yes-no / dates):
 *       ==, !=, >, <, >=, <=
 *   - Dedicated date operators (force day-level compare; refuse on
 *     non-parseable date strings instead of silently falling back to
 *     lexicographic string compare):
 *       date_before, date_after, date_on_or_before, date_on_or_after,
 *       date_equals
 *
 * Deliberately EXCLUDED:
 *   - `===` / `!==`: backend-only; the frontend evaluator doesn't parse
 *     them (it always returns `true`), which would create a divergence
 *     where a rule fires on the backend but not in the patient form.
 *   - Verbose aliases (`equals`, `gt`, `lte`, …): not in either evaluator.
 *   - `before` / `after` without `date_` prefix: not in either evaluator.
 */
const VALID_OPERATORS = new Set<string>([
  '==', '!=', '>', '<', '>=', '<=',
  'date_before', 'date_after',
  'date_on_or_before', 'date_on_or_after',
  'date_equals',
]);

/**
 * Subset of VALID_OPERATORS that REQUIRE both sides to be parseable as
 * dates. We use this to reject `consistency` rules that pair a date_*
 * operator with a non-date `compareValue` — that combination silently
 * never fires at runtime (parseToDateOnly returns null → compareValues
 * returns true → rule passes always).
 */
const DATE_OPERATORS = new Set<string>([
  'date_before', 'date_after',
  'date_on_or_before', 'date_on_or_after',
  'date_equals',
]);

/**
 * Common LLM hallucinations / aliases that look like operators but the
 * runtime ignores. We keep a friendly map so the rejection message can
 * suggest the canonical form, rather than just saying "invalid_operator".
 */
const OPERATOR_ALIAS_HINTS: Record<string, string> = {
  '===': '==',
  '!==': '!=',
  'equal': '==', 'equals': '==', 'eq': '==', 'is': '==',
  'not_equal': '!=', 'not_equals': '!=', 'notequals': '!=', 'ne': '!=', 'neq': '!=',
  'gt': '>', 'greater': '>', 'greater_than': '>', 'above': '>',
  'lt': '<', 'less': '<', 'less_than': '<', 'below': '<',
  'gte': '>=', 'greater_or_equal': '>=', 'at_least': '>=',
  'lte': '<=', 'less_or_equal': '<=', 'at_most': '<=',
  'before': 'date_before', 'prior_to': 'date_before',
  'after': 'date_after', 'later_than': 'date_after',
  'on_or_before': 'date_on_or_before', 'no_later_than': 'date_on_or_before',
  'on_or_after': 'date_on_or_after', 'no_earlier_than': 'date_on_or_after',
  'date_equal': 'date_equals', 'same_date': 'date_equals',
};

/**
 * Loose date-string parser used in the validator's pre-flight check on
 * `consistency` rules with date_* operators. Mirrors `parseToDateOnly`
 * in the runtime (`validation-rules.service.ts`), which accepts:
 *   1) `^YYYY-MM-DD...` regex (preferred — anchored)
 *   2) Anything `Date.parse()` accepts as a fallback (RFC 2822, MM/DD/YYYY,
 *      ISO datetimes, etc.). Notably `Date.parse` does NOT reliably
 *      handle `DD/MM/YYYY` — `15/01/2024` returns NaN because JS treats
 *      `15` as month 15.
 *
 * Returns true when the string would parse on the runtime side. We
 * deliberately reject pure-numeric strings even when `Date.parse` accepts
 * them (e.g. `'2020'`) because those almost certainly aren't what the AI
 * meant by a date.
 */
function looksLikeDateString(s: string): boolean {
  if (typeof s !== 'string' || s.length < 4) return false;
  // ISO date / datetime — runtime fast path.
  if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
    return true;
  }
  // US slash date — Date.parse handles MM/DD/YYYY reliably.
  if (/^(0[1-9]|1[0-2]|[1-9])\/(0[1-9]|[12]\d|3[01]|[1-9])\/\d{4}$/.test(s)) return true;
  // Date.parse fallback — covers RFC 2822, "January 15, 2024", etc.
  // Exclude pure numerics (Date.parse('2020') returns the year).
  if (s.length >= 8 && !/^-?\d+(\.\d+)?$/.test(s) && !isNaN(Date.parse(s))) return true;
  return false;
}

/**
 * Field types where a `range` rule is silently a no-op at runtime
 * (multi-value, blob, structural, display). Emitting such a rule is
 * worse than refusing because the human reviewer signs an invariant
 * that never fires.
 *
 * Source of truth: `applyRule` in validation-rules.service.ts —
 * isMultiValue/isBloodPressure short-circuits, and structural types
 * never reach a value-bearing branch.
 */
const RANGE_INCOMPATIBLE_TYPES = new Set<string>([
  'checkbox', 'multi-select', 'multiselect',  // arrays
  'file', 'image', 'signature',                // UUID blobs
  'table', 'question_table',                   // structural — only required at field level
  'inline_group', 'criteria_list',             // structural
  'section_header', 'static_text',             // display
  // Pure text / select types: range against a non-numeric is meaningless.
  'text', 'textarea', 'email', 'phone', 'address',
  'patient_name', 'patient_id', 'ssn', 'medical_record_number',
  'medication', 'diagnosis', 'procedure', 'lab_result',
  'select', 'combobox', 'radio', 'yesno',
  'barcode', 'qrcode',
]);

/**
 * Field types where a `format` / `pattern_match` rule is silently a no-op
 * at runtime (multi-value arrays + binary blobs). Single-value text /
 * date / number fields are all fine for format.
 *
 * yesno is here because the runtime stores yes/no values in a tiny
 * canonical set ('yes'/'no'/'true'/'false'/'0'/'1'), so regex
 * validation against them is virtually always nonsensical — the author
 * almost certainly meant value_match (compareValue) or consistency.
 * Allowing format on yesno produces rules that fire on every value
 * because most regexes won't match the literal "yes"/"no" strings.
 */
const FORMAT_INCOMPATIBLE_TYPES = new Set<string>([
  'checkbox', 'multi-select', 'multiselect',  // runtime returns valid:true for arrays in format branch
  'file', 'image', 'signature',                // UUID blobs
  'yesno',                                     // tiny canonical value set; use value_match/consistency instead
  'table', 'question_table',
  'inline_group', 'criteria_list',
  'section_header', 'static_text',
]);

/** Minimum self-test pairs the LLM MUST supply for regex / format rules. */
const MIN_SELF_TEST_EXAMPLES = 1;

export interface ValidatorReject {
  rule: SuggestedRule;
  reason: string;
  /** When `retryable=true` the orchestrator MAY send this back to the LLM
   *  with the failure message and ask for one retry. Examples: regex
   *  doesn't compile, self-test fails. We DO NOT mark structural errors
   *  (forbidden type, unknown field) as retryable because the LLM has
   *  already been told these constraints in the system prompt. */
  retryable: boolean;
  /** When retryable, the failure context the orchestrator should attach
   *  to the retry prompt. */
  retryContext?: string;
}

export interface ValidatorResult {
  accepted: SuggestedRule[];
  rejected: ValidatorReject[];
  warnings: string[];
}

interface ValidatorContext {
  fieldContext: ReadonlyArray<FieldContextEntry>;
  /** Set of allowed format types (registry keys + 'custom_regex'). */
  formatTypeKeys: ReadonlySet<string>;
  /** Map fieldPath -> field for O(1) lookup. */
  fieldByPath: ReadonlyMap<string, FieldContextEntry>;
}

/** Run the full validator pipeline. Pure function. */
export function validateSuggestions(
  suggestions: ReadonlyArray<SuggestedRule>,
  fieldContext: ReadonlyArray<FieldContextEntry>,
): ValidatorResult {
  const ctx = buildContext(fieldContext);
  const accepted: SuggestedRule[] = [];
  const rejected: ValidatorReject[] = [];
  const warnings: string[] = [];

  const re2Status = getRe2LoadStatus();
  if (!re2Status.available) {
    warnings.push(
      `regex sandbox running in JS-only mode (re2-wasm load failed: ${re2Status.error || 'unknown'}). ` +
      `Custom-regex suggestions will still be validated for syntax + self-test, ` +
      `but ReDoS-safety guarantees do not apply this run.`
    );
  }

  for (const suggestion of suggestions) {
    const decision = validateOne(suggestion, ctx);
    if (decision.kind === 'accepted') {
      accepted.push(decision.rule);
    } else {
      rejected.push({
        rule: decision.original,
        reason: decision.reason,
        retryable: decision.retryable,
        retryContext: decision.retryContext,
      });
    }
  }

  return { accepted, rejected, warnings };
}

type SingleDecision =
  | { kind: 'accepted'; rule: SuggestedRule }
  | {
      kind: 'rejected';
      original: SuggestedRule;
      reason: string;
      retryable: boolean;
      retryContext?: string;
    };

function buildContext(fieldContext: ReadonlyArray<FieldContextEntry>): ValidatorContext {
  const fieldByPath = new Map<string, FieldContextEntry>();
  for (const f of fieldContext) {
    if (f && typeof f.path === 'string' && f.path) {
      fieldByPath.set(f.path, f);
    }
  }
  // Format types come from the runtime registry — same JSON file the
  // patient form evaluator reads. This guarantees the validator can't
  // accept a formatType the runtime can't resolve.
  const keys = new Set<string>(Object.keys(FORMAT_TYPE_REGISTRY));
  // 'custom_regex' is the registry's own escape hatch — pattern stored on the rule.
  keys.add('custom_regex');
  return { fieldContext, formatTypeKeys: keys, fieldByPath };
}

function validateOne(raw: SuggestedRule, ctx: ValidatorContext): SingleDecision {
  if (!raw || typeof raw !== 'object') {
    return rejectStructural(raw, 'rule_not_object');
  }
  // Reconstruct into a fresh object containing ONLY whitelisted properties.
  // This is the runtime equivalent of `additionalProperties: false` in the
  // JSON schema — it defends against LLMs that ignore the schema, and
  // against any future provider that smuggles vendor-specific debug
  // fields onto the rule.
  const rule: any = {};
  for (const k of Object.keys(raw as any)) {
    if (ALLOWED_RULE_PROPERTIES.has(k)) {
      rule[k] = (raw as any)[k];
    }
  }
  for (const f of ALWAYS_STRIP_FIELDS) {
    if (f in rule) delete rule[f];
  }

  // === Gate A: rule type ===
  if (typeof rule.ruleType !== 'string') {
    return rejectStructural(raw, 'missing_ruleType');
  }
  if (FORBIDDEN_RULE_TYPES.has(rule.ruleType)) {
    return rejectStructural(raw, `forbidden_ruleType: ${rule.ruleType}`);
  }
  if (!ALLOWED_RULE_TYPES.has(rule.ruleType as SuggestedRuleType)) {
    return rejectStructural(raw, `unknown_ruleType: ${rule.ruleType}`);
  }

  // === Gate B: identity & target field ===
  if (typeof rule.fieldPath !== 'string' || !rule.fieldPath) {
    return rejectStructural(raw, 'missing_fieldPath');
  }
  const field = ctx.fieldByPath.get(rule.fieldPath);
  if (!field) {
    return rejectStructural(
      raw,
      `unknown_fieldPath: '${rule.fieldPath}' is not in the AVAILABLE FIELDS list`,
    );
  }
  // Force itemId to match the resolved field so the AI can't smuggle a
  // mismatched itemId through. This also fixes any hallucinated itemId.
  if (typeof field.itemId === 'number' && field.itemId > 0) {
    rule.itemId = field.itemId;
  } else if (typeof rule.itemId !== 'number' || rule.itemId <= 0) {
    return rejectStructural(raw, 'missing_itemId_on_resolved_field');
  }

  // === Gate C: severity / messages ===
  if (rule.severity !== 'error' && rule.severity !== 'warning') {
    return rejectStructural(raw, 'invalid_severity');
  }
  if (typeof rule.errorMessage !== 'string' || rule.errorMessage.length === 0) {
    return rejectStructural(raw, 'missing_errorMessage');
  }
  if (rule.errorMessage.length > 1000) {
    rule.errorMessage = rule.errorMessage.substring(0, 1000);
  }
  if (typeof rule.name !== 'string' || rule.name.length === 0) {
    rule.name = `ai_${rule.ruleType}_${field.label || rule.fieldPath}`.substring(0, 60);
  }
  if (typeof rule.rationale !== 'string' || rule.rationale.length === 0) {
    rule.rationale = `(no rationale provided by AI)`;
  }

  // === Gate D: type-specific validation ===
  switch (rule.ruleType as SuggestedRuleType) {
    case 'required':
      // No additional fields needed. Drop irrelevant ones to keep payload clean.
      delete rule.minValue; delete rule.maxValue;
      delete rule.pattern; delete rule.formatType;
      delete rule.operator; delete rule.compareValue; delete rule.compareFieldPath;
      break;

    case 'range': {
      const minOk = typeof rule.minValue === 'number' && Number.isFinite(rule.minValue);
      const maxOk = typeof rule.maxValue === 'number' && Number.isFinite(rule.maxValue);
      const bpOk = ['bpSystolicMin', 'bpSystolicMax', 'bpDiastolicMin', 'bpDiastolicMax']
        .some(k => typeof rule[k] === 'number' && Number.isFinite(rule[k]));
      if (!minOk && !maxOk && !bpOk) {
        return rejectStructural(raw, 'range_rule_missing_bounds');
      }
      if (minOk && maxOk && rule.minValue > rule.maxValue) {
        return rejectStructural(raw, `range_rule_min_greater_than_max: ${rule.minValue} > ${rule.maxValue}`);
      }
      // Type-appropriateness gate. The runtime returns valid:true (skips)
      // for range rules on multi-value/blob/structural fields; emitting
      // such a rule would be silently inert and confuse the human
      // reviewer.
      const fieldType = (field.type || '').toLowerCase();
      if (RANGE_INCOMPATIBLE_TYPES.has(fieldType)) {
        return rejectStructural(
          raw,
          `range_on_incompatible_type: '${fieldType}' field '${field.path}' cannot have a range rule`,
        );
      }
      // BP-specific bounds: only meaningful on a blood_pressure field.
      if (bpOk && fieldType !== 'blood_pressure') {
        return rejectStructural(
          raw,
          `bp_bounds_on_non_bp_field: '${fieldType}' field '${field.path}' cannot use bpSystolicMin/Max etc.`,
        );
      }
      // Strip irrelevant fields.
      delete rule.pattern; delete rule.formatType;
      delete rule.operator; delete rule.compareValue; delete rule.compareFieldPath;
      break;
    }

    case 'format': {
      // Type-appropriateness gate. Format on arrays/blobs/structural is a
      // silent no-op at runtime; reject so the human reviewer never sees
      // a rule that can't fire.
      const fmtFieldType = (field.type || '').toLowerCase();
      if (FORMAT_INCOMPATIBLE_TYPES.has(fmtFieldType)) {
        return rejectStructural(
          raw,
          `format_on_incompatible_type: '${fmtFieldType}' field '${field.path}' cannot have a format rule`,
        );
      }
      // Either formatType (registry key) or pattern (custom regex) is required.
      let ft = rule.formatType;
      const hasPattern = typeof rule.pattern === 'string' && rule.pattern.length > 0;

      // SERVER-SIDE RECOVERY for a known Gemini 2.5-flash flaw:
      // when asked to apply a registry key, the model sometimes
      // mentions the key by name in `rationale` ("matched the
      // FORMAT_TYPE_REGISTRY 'subject_id' key") but FORGETS to populate
      // the `formatType` field in its JSON output. Even with prompt
      // hints + retries, this slot remains stubbornly empty for some
      // descriptions (it's a known structured-output edge case).
      //
      // If both formatType and pattern are missing, scan the rationale
      // for an explicit registry-key reference and inject it. We match
      // ONLY known registry keys, so this can't smuggle anything dangerous.
      if ((!ft || ft === '' || ft === 'custom_regex') && !hasPattern) {
        const rationale = (typeof rule.rationale === 'string' ? rule.rationale : '') + ' ' +
                          (typeof rule.errorMessage === 'string' ? rule.errorMessage : '') + ' ' +
                          (typeof rule.name === 'string' ? rule.name : '');
        // Look for either a quoted key ('subject_id', "phone_us") or a
        // bare reference like `formatType=email`. We require the key to
        // be in the registry to count.
        const candidates = new Set<string>();
        const quotedRe = /['"`]([a-z][a-z0-9_]+)['"`]/g;
        let m: RegExpExecArray | null;
        while ((m = quotedRe.exec(rationale)) !== null) candidates.add(m[1]);
        // Also try unquoted snake_case identifiers near "format" keywords.
        const unquotedRe = /\bformat(?:Type)?\s*[=:]?\s*([a-z][a-z0-9_]+)/gi;
        while ((m = unquotedRe.exec(rationale)) !== null) candidates.add(m[1].toLowerCase());

        for (const key of candidates) {
          if (ctx.formatTypeKeys.has(key) && key !== 'custom_regex') {
            ft = key;
            rule.formatType = key;
            // Tag the rule so the audit log shows we recovered.
            const note = `[server-recovered formatType="${key}" from rationale]`;
            rule.rationale = (rule.rationale ? rule.rationale + ' ' : '') + note;
            break;
          }
        }
      }

      if (typeof ft === 'string' && ft && ft !== 'custom_regex') {
        if (!ctx.formatTypeKeys.has(ft)) {
          // Retryable: hint at the close registry key the LLM probably meant.
          // This handles common mistakes like "email_address" → "email".
          return rejectRetryable(
            raw,
            `unknown_formatType: ${ft}`,
            `Your "${rule.name}" rule used formatType="${ft}" which is NOT in the FORMAT_TYPE_REGISTRY. ` +
            `Pick exactly one of the documented keys (e.g. email, phone_us, subject_id, date_iso, etc.) ` +
            `or omit formatType and provide a custom \`pattern\` instead.`,
          );
        }
        // Don't keep both — registry resolves the pattern at runtime.
        delete rule.pattern;
      } else if (hasPattern) {
        const compile = safeCompile(rule.pattern);
        if (compile.ok === false) {
          const reason = compile.reason;
          // Retryable: send the LLM the compile error and ask it to fix.
          return rejectRetryable(
            raw,
            `pattern_unsafe: ${reason}`,
            `Your previous regex for "${rule.name}" failed the safety check: ${reason}. ` +
            `Re-emit the rule with a re2-compatible pattern (no lookbehind, no backreferences) or ` +
            `pick a registry formatType key.`,
          );
        }
        rule.formatType = 'custom_regex';
      } else {
        // The LLM emitted a `format` rule without either `formatType` or
        // `pattern` — the most common mistake we observed in production
        // is the LLM saying in `rationale` "matched the email registry"
        // but FORGETTING to actually populate `formatType: "email"`.
        // Make this RETRYABLE with a corrective hint so the second pass
        // fills in the missing field.
        return rejectRetryable(
          raw,
          `format_rule_missing_pattern_or_formatType`,
          `Your "${rule.name}" format rule is missing BOTH "formatType" and "pattern". ` +
          `If your rationale says you used a registry key (e.g. "email", "phone_us", "subject_id", ` +
          `"date_iso"), you MUST populate the "formatType" field with that exact key. ` +
          `Otherwise, populate "pattern" with a re2-compatible regex.`,
        );
      }
      // Self-test gate (Gate 4) for any rule with a pattern or registry key.
      const selfCheck = runSelfTestGate(rule);
      if (selfCheck.ok === false) {
        const reason = selfCheck.reason;
        // Include the ACTUAL pattern / formatType the LLM emitted so the
        // retry can compare its examples against the regex it wrote.
        // Without this hint the LLM often re-emits the same broken regex
        // because it has no idea which side was wrong.
        const emitted = rule.pattern
          ? `pattern="${rule.pattern}"`
          : `formatType="${rule.formatType}"`;
        return rejectRetryable(
          raw,
          `self_test_failed: ${reason}`,
          `Your previous rule "${rule.name}" used ${emitted} but its own selfTest examples disagreed with that regex: ${reason}. ` +
          `Decide which side is correct: ` +
          `(a) if the regex is right, replace the wrong selfTest examples; ` +
          `(b) if the examples are right, fix the regex to match them. ` +
          `Test each shouldPass example mentally against your regex before re-emitting.`,
        );
      }
      // Strip irrelevant
      delete rule.minValue; delete rule.maxValue;
      delete rule.operator; delete rule.compareValue; delete rule.compareFieldPath;
      break;
    }

    case 'consistency': {
      const op = rule.operator;
      if (typeof op !== 'string' || !VALID_OPERATORS.has(op)) {
        // Friendly hint when the LLM picked a known alias (e.g. 'gt' for '>').
        const hint = typeof op === 'string' ? OPERATOR_ALIAS_HINTS[op.toLowerCase()] : undefined;
        const reason = hint
          ? `invalid_operator: '${op}' is not a runtime operator. Did you mean '${hint}'? See OPERATOR VOCABULARY in the prompt.`
          : `invalid_operator: '${op}'. Allowed: ${Array.from(VALID_OPERATORS).join(', ')}.`;
        // Retryable: this is exactly the kind of single-token mistake an
        // LLM can fix with a corrective hint, and shipping a rule with
        // a silently-ignored operator (returns valid:true forever) is
        // worse than an extra retry round-trip.
        return rejectRetryable(raw, reason, reason);
      }
      const hasCompareField = typeof rule.compareFieldPath === 'string' && rule.compareFieldPath.length > 0;
      const hasCompareValue = typeof rule.compareValue === 'string' && rule.compareValue.length > 0;
      if (!hasCompareField && !hasCompareValue) {
        return rejectStructural(raw, 'consistency_rule_missing_comparison_target');
      }
      if (hasCompareField && hasCompareValue) {
        // Runtime prefers compareValue and silently ignores compareFieldPath
        // when both are set, which produces audit-log ambiguity ("did the
        // author mean to compare against the literal or the field?").
        // Reject so the LLM picks ONE on retry.
        return rejectStructural(
          raw,
          'consistency_rule_has_both_compareValue_and_compareFieldPath',
        );
      }
      if (hasCompareField && !ctx.fieldByPath.has(rule.compareFieldPath)) {
        return rejectStructural(raw, `unknown_compareFieldPath: ${rule.compareFieldPath}`);
      }
      // Forbid self-reference — comparing a field to itself is always
      // either trivially true (==) or false (!=), and is almost certainly
      // a hallucination.
      if (hasCompareField && rule.compareFieldPath === rule.fieldPath) {
        return rejectStructural(raw, 'consistency_rule_self_reference');
      }
      // date_* operators require a parseable date on BOTH sides at
      // runtime. When `compareValue` is a literal we can pre-flight
      // check it here — far better than silently shipping a rule that
      // returns valid:true forever because parseToDateOnly returned
      // null. (When `compareFieldPath` is set we trust the field type
      // metadata; if the field is non-date we already reject in the
      // type-appropriateness gate below.)
      if (DATE_OPERATORS.has(op) && hasCompareValue && !looksLikeDateString(rule.compareValue)) {
        return rejectRetryable(
          raw,
          `date_operator_with_non_date_compareValue: '${op}' requires a parseable date string in compareValue (got '${rule.compareValue}')`,
          `Operator '${op}' requires a date in compareValue (formats: YYYY-MM-DD, MM/DD/YYYY, ISO datetime). ` +
          `Got '${rule.compareValue}'. Re-emit with a parseable date or pick a generic operator.`,
        );
      }
      // date_* operators against a non-date field are nonsensical too.
      if (DATE_OPERATORS.has(op)) {
        const ftype = (field.type || '').toLowerCase();
        const isDateFamily = ftype === 'date' || ftype === 'date_of_birth' || ftype === 'datetime';
        if (!isDateFamily) {
          return rejectStructural(
            raw,
            `date_operator_on_non_date_field: '${op}' on field '${field.path}' (type ${ftype || 'unknown'}); use a generic operator instead`,
          );
        }
        // If comparing to another field, that field MUST also be date-family.
        if (hasCompareField) {
          const cmpField = ctx.fieldByPath.get(rule.compareFieldPath)!;
          const cmpType = (cmpField.type || '').toLowerCase();
          const cmpIsDateFamily = cmpType === 'date' || cmpType === 'date_of_birth' || cmpType === 'datetime';
          if (!cmpIsDateFamily) {
            return rejectStructural(
              raw,
              `date_operator_with_non_date_compareField: compareFieldPath '${rule.compareFieldPath}' is type '${cmpType || 'unknown'}', not a date family field`,
            );
          }
        }
      }
      delete rule.minValue; delete rule.maxValue;
      delete rule.pattern; delete rule.formatType;
      break;
    }

    case 'value_match': {
      if (typeof rule.compareValue !== 'string' || !rule.compareValue.length) {
        return rejectStructural(raw, 'value_match_missing_compareValue');
      }
      // value_match runtime semantics: rule fires WHEN value matches
      // compareValue. operator is not consumed by the runtime for this
      // rule type — emitting one (e.g. 'equals' or '==') is misleading
      // garbage in the saved rule and the audit trail. Strip silently.
      delete rule.operator;
      delete rule.minValue; delete rule.maxValue;
      delete rule.pattern; delete rule.formatType; delete rule.compareFieldPath;
      break;
    }

    case 'pattern_match': {
      // pattern_match runtime: works on strings + arrays-of-strings, but
      // is meaningless for blob/structural fields.
      const pmFieldType = (field.type || '').toLowerCase();
      if (FORMAT_INCOMPATIBLE_TYPES.has(pmFieldType)
          // checkbox is fine for pattern_match (runtime iterates the array),
          // unlike format. Re-allow it.
          && pmFieldType !== 'checkbox' && pmFieldType !== 'multi-select' && pmFieldType !== 'multiselect') {
        return rejectStructural(
          raw,
          `pattern_match_on_incompatible_type: '${pmFieldType}' field '${field.path}' cannot have a pattern_match rule`,
        );
      }
      if (typeof rule.pattern !== 'string' || !rule.pattern.length) {
        return rejectStructural(raw, 'pattern_match_missing_pattern');
      }
      const compile = safeCompile(rule.pattern);
      if (compile.ok === false) {
        const reason = compile.reason;
        return rejectRetryable(
          raw,
          `pattern_unsafe: ${reason}`,
          `Your previous regex for "${rule.name}" failed the safety check: ${reason}. ` +
          `Re-emit the rule with a re2-compatible pattern.`,
        );
      }
      const selfCheck = runSelfTestGate(rule);
      if (selfCheck.ok === false) {
        const reason = selfCheck.reason;
        // Remember: pattern_match FIRES on match. Most LLM mistakes here
        // are getting the semantics inverted in the selfTest examples.
        return rejectRetryable(
          raw,
          `self_test_failed: ${reason}`,
          `Your previous pattern_match rule "${rule.name}" used pattern="${rule.pattern}" but its selfTest examples disagreed: ${reason}. ` +
          `REMEMBER pattern_match FIRES (returns invalid) WHEN the regex matches the value. ` +
          `So shouldPass = values that should NOT match (rule does NOT fire); ` +
          `shouldFail = values that SHOULD match (rule fires). ` +
          `Re-emit with corrected examples or fix the regex.`,
        );
      }
      delete rule.minValue; delete rule.maxValue;
      delete rule.formatType; delete rule.operator; delete rule.compareValue; delete rule.compareFieldPath;
      break;
    }
  }

  // tableCellTarget — AI is forbidden from emitting this (per prompt).
  // Strip silently if present so we never persist an AI-emitted cell target.
  if (rule.tableCellTarget) {
    delete rule.tableCellTarget;
  }

  return { kind: 'accepted', rule: rule as SuggestedRule };
}

/**
 * Self-test gate: run the rule's own positive/negative examples through
 * `testRuleDirectly` and verify the runtime evaluator agrees with the AI.
 * If the AI didn't supply self-tests for a regex/format rule, that's
 * acceptable for `value_match` and `consistency` (which don't use
 * regex), but we synthesize a minimal one for format / pattern_match.
 */
function runSelfTestGate(
  rule: any,
): { ok: true } | { ok: false; reason: string } {
  const st = rule.selfTest;
  if (!st || !Array.isArray(st.shouldPass) || !Array.isArray(st.shouldFail)) {
    return {
      ok: false,
      reason: 'no selfTest provided; format / pattern_match rules MUST include shouldPass + shouldFail',
    };
  }
  if (st.shouldPass.length < MIN_SELF_TEST_EXAMPLES || st.shouldFail.length < MIN_SELF_TEST_EXAMPLES) {
    return {
      ok: false,
      reason: `selfTest needs at least ${MIN_SELF_TEST_EXAMPLES} shouldPass and ${MIN_SELF_TEST_EXAMPLES} shouldFail`,
    };
  }

  // Build a transient ValidationRule shaped like the runtime expects so
  // testRuleDirectly evaluates it identically to a real one.
  const runtime: RuntimeValidationRule = {
    id: 0,
    validationRuleId: 0,
    crfId: 0,
    name: rule.name,
    description: rule.description || '',
    ruleType: rule.ruleType,
    fieldPath: 'testField',  // testRuleDirectly reads value from data.testField
    severity: rule.severity,
    errorMessage: rule.errorMessage,
    active: true,
    minValue: rule.minValue,
    maxValue: rule.maxValue,
    pattern: rule.pattern,
    formatType: rule.formatType,
    operator: rule.operator,
    compareFieldPath: rule.compareFieldPath,
    compareValue: rule.compareValue,
    bpSystolicMin: rule.bpSystolicMin,
    bpSystolicMax: rule.bpSystolicMax,
    bpDiastolicMin: rule.bpDiastolicMin,
    bpDiastolicMax: rule.bpDiastolicMax,
    dateCreated: new Date(),
    createdBy: 0,
  };

  const failures: string[] = [];

  for (const value of st.shouldPass) {
    try {
      const r = testRuleDirectly(runtime, value, { testField: value });
      if (!r.valid) failures.push(`shouldPass[${JSON.stringify(value)}] returned invalid`);
    } catch (err: any) {
      failures.push(`shouldPass[${JSON.stringify(value)}] threw: ${err?.message || 'unknown'}`);
    }
  }
  for (const value of st.shouldFail) {
    try {
      const r = testRuleDirectly(runtime, value, { testField: value });
      if (r.valid) failures.push(`shouldFail[${JSON.stringify(value)}] returned valid`);
    } catch (err: any) {
      failures.push(`shouldFail[${JSON.stringify(value)}] threw: ${err?.message || 'unknown'}`);
    }
  }

  if (failures.length === 0) return { ok: true };

  // For diagnosability also try with safeTest to see if the regex agrees:
  if (rule.pattern) {
    const compile = safeCompile(rule.pattern);
    if (compile.ok) {
      logger.debug('self-test failure regex diagnostics', {
        pattern: rule.pattern,
        shouldPass_via_safeTest: (st.shouldPass as string[]).map((v) => ({
          value: v, matches: safeTest(compile.jsEngine, v),
        })),
        shouldFail_via_safeTest: (st.shouldFail as string[]).map((v) => ({
          value: v, matches: safeTest(compile.jsEngine, v),
        })),
      });
    }
  }

  return { ok: false, reason: failures.slice(0, 5).join('; ') };
}

function rejectStructural(rule: SuggestedRule, reason: string): SingleDecision {
  return { kind: 'rejected', original: rule, reason, retryable: false };
}

function rejectRetryable(
  rule: SuggestedRule,
  reason: string,
  retryContext: string,
): SingleDecision {
  return { kind: 'rejected', original: rule, reason, retryable: true, retryContext };
}

/**
 * Helper for the orchestrator's retry loop: split a rejected list into
 * "retryable failures the LLM might fix" vs "permanent failures".
 */
export function splitForRetry(rejected: ValidatorReject[]): {
  retryable: ValidatorReject[];
  permanent: ValidatorReject[];
} {
  const retryable: ValidatorReject[] = [];
  const permanent: ValidatorReject[] = [];
  for (const r of rejected) {
    (r.retryable ? retryable : permanent).push(r);
  }
  return { retryable, permanent };
}
