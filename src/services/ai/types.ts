/**
 * AI rule-compiler types (backend).
 *
 * These mirror the frontend interfaces in
 *   ElectronicDataCaptureReal/src/app/interfaces/services/rule-suggestion-provider.interface.ts
 * so the API contract is symmetric and drift-resistant.
 *
 * Whenever you change shapes here you MUST also change the frontend file
 * (and vice versa). The integration test in
 *   validation-rule-audit/test-scripts/verify-ai-compile.ps1
 * exercises the live wire format end-to-end and will catch most drift.
 *
 * Forbidden rule types:
 *   formula / business_logic / cross_form
 * are intentionally NOT in `SuggestedRuleType` — the union narrows them
 * out of the type system. We ALSO defend in depth at runtime in
 * `rule-validator.service.ts` because a misbehaving LLM could still
 * emit them as a string field, and TypeScript guarantees end at the JSON
 * boundary.
 */

export type SuggestedRuleType =
  | 'required'
  | 'range'
  | 'format'
  | 'consistency'
  | 'value_match'
  | 'pattern_match'
  | 'formula';

/**
 * Mirror of the frontend FieldContextEntry. NEVER carries patient values —
 * only the shape (label, type, options, optional metadata).
 */
export interface FieldContextEntry {
  path: string;
  label: string;
  /** Canonical field type (text, number, date, select, table, ...). */
  type: string;
  itemId: number;
  required?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;

  /** For table fields. */
  tableColumns?: Array<FieldContextColumn>;
  /** For question_table fields. */
  questionRows?: Array<{
    id: string;
    question: string;
    answerColumns: Array<FieldContextColumn>;
  }>;

  /** Optional semantic-tag hint, e.g. 'dob', 'systolic_bp'. */
  semanticTag?: string;
  /** Optional plain-English description of the field. */
  description?: string;
}

export interface FieldContextColumn {
  id: string;
  label: string;
  type: string;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
}

/**
 * Lightweight existing-rule summary. Provider uses these to avoid emitting
 * near-duplicates and to surface conflicts. We deliberately do NOT include
 * evaluator-internal fields (createdBy, dateCreated, etc.) — keeps the
 * prompt small and isolation-safe.
 */
export interface ExistingRuleSummary {
  id: number;
  name?: string;
  ruleType: string;
  fieldPath: string;
  severity: 'error' | 'warning';
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  formatType?: string;
  operator?: string;
  compareValue?: string;
  compareFieldPath?: string;
}

export interface SuggestedTableCellTarget {
  tableFieldPath: string;
  tableItemId: number;
  columnId: string;
  columnType: string;
  rowIndex?: number;
  rowId?: string;
  allRows: boolean;
  displayPath: string;
}

/**
 * Self-test pair the provider supplies. The validator runs each value
 * through `testRuleDirectly` and rejects the rule if any expectation
 * fails.
 */
export interface SuggestedSelfTest {
  shouldPass: string[];
  shouldFail: string[];
}

export interface SuggestedRule {
  name: string;
  description?: string;
  ruleType: SuggestedRuleType;
  fieldPath: string;
  itemId: number;
  severity: 'error' | 'warning';
  errorMessage: string;
  warningMessage?: string;

  // Rule-type-specific
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  formatType?: string;
  operator?: string;
  compareFieldPath?: string;
  compareValue?: string;
  customExpression?: string;

  // BP-specific
  bpSystolicMin?: number;
  bpSystolicMax?: number;
  bpDiastolicMin?: number;
  bpDiastolicMax?: number;

  /** Cell-level scoping for table / question_table targets. */
  tableCellTarget?: SuggestedTableCellTarget;

  /** Provider's rationale. Required so the human reviewer can sanity-check. */
  rationale: string;

  /** Self-test pairs the validator runs through testRuleDirectly. */
  selfTest?: SuggestedSelfTest;

  /** Provider's own warning about this suggestion (ambiguity, assumption). */
  providerWarning?: string;
}

export interface RuleSuggestionRequest {
  description: string;
  /** May be empty []; the orchestrator will refuse with a helpful error. */
  fieldContext: FieldContextEntry[];
  existingRules: ExistingRuleSummary[];
  /** UUID v4 string from the caller (frontend usually generates). */
  correlationId: string;
  /** Soft cap; orchestrator hard-caps via env `AI_COMPILER_MAX_RULES_HARD_CAP`. */
  maxRules: number;
  /** Cache key — same key MUST yield the same response. */
  idempotencyKey: string;

  /**
   * Optional CRF identifier the suggestion is for. When present the
   * orchestrator can audit-log it. Not used for context lookup; the
   * frontend already passes the resolved `fieldContext`.
   */
  crfId?: number;
}

export interface RuleSuggestionResponseStats {
  providerName: string;
  modelId: string;
  modelVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Estimated USD cost for cost-meter / dashboards. May be 0 for mock. */
  costUsd?: number;
  latencyMs: number;
  correlationId: string;
  /** Whether this response was served from the idempotency cache. */
  fromCache?: boolean;
}

export interface RuleSuggestionResponseFlags {
  refused: boolean;
  refusedReason?: string;
  containedPhi: boolean;
}

export interface RuleSuggestionResponse {
  rules: SuggestedRule[];
  warnings: string[];
  flags: RuleSuggestionResponseFlags;
  stats: RuleSuggestionResponseStats;
}

/**
 * Provider contract. ONE method that producs rules. Providers MUST NOT
 * throw for normal failure — they return `{ rules:[], flags:{refused:true}, ... }`.
 *
 * Providers SHOULD honour `signal` for hard timeouts but the orchestrator
 * also wraps every call in `Promise.race([call, timeout])` so a misbehaving
 * provider can't hang the request.
 */
export interface AiProvider {
  readonly providerName: 'openai' | 'gemini' | 'mock';
  readonly modelId: string;

  /** Cheap availability check; SHOULD NOT call the LLM. */
  ping(): Promise<{ ok: boolean; reason?: string }>;

  /**
   * Generate raw structured suggestions. The orchestrator post-validates
   * everything before returning to the caller. Providers MAY include
   * extra fields the orchestrator will strip.
   */
  generate(input: {
    systemPrompt: string;
    userPrompt: string;
    schema: Record<string, unknown>;
    correlationId: string;
    timeoutMs: number;
  }): Promise<{
    rules: SuggestedRule[];
    warnings?: string[];
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    modelVersion?: string;
  }>;
}

/**
 * Caller context passed by the controller into the orchestrator.
 * Used for audit trail and authorization checks.
 */
export interface CompileCallerContext {
  userId: number;
  username: string;
  /** User's role / userType — informational, not used for auth (route gate handles that). */
  role?: string;
}
