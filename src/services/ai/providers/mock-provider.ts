/**
 * MockAiProvider — deterministic backend provider that exercises the
 * full orchestrator pipeline (PHI scan, idempotency cache, validator
 * gates, audit log, retry loop) WITHOUT calling a real LLM.
 *
 * Why this exists separately from the frontend's MockRuleSuggestionProvider:
 *   - The frontend mock is used by the `MockRuleSuggestionProvider`
 *     binding which talks DIRECTLY to the suggester service, bypassing
 *     the entire backend orchestrator.
 *   - This backend mock plugs into `getProvider()` and lets you exercise
 *     EVERY gate the production OpenAI/Gemini path goes through. That's
 *     the only way to verify the orchestrator without spending API
 *     tokens.
 *
 * Use cases:
 *   1. Local dev — set `AI_COMPILER_ENABLED=true AI_COMPILER_PROVIDER=mock`
 *      and the full pipeline runs end-to-end with deterministic output.
 *   2. CI / smoke tests — same thing without burning the OpenAI quota.
 *   3. Failover — operator can flip from `openai` to `mock` if the
 *      provider quota is exhausted, so the UI keeps producing
 *      (limited) suggestions instead of hard-failing.
 *   4. PHI scanner verification — the orchestrator's PHI gate fires
 *      BEFORE the provider, so you can prove the gate works without
 *      ever hitting an LLM.
 *
 * Behavior: same keyword mapping as the frontend MockRuleSuggestionProvider,
 * deliberately kept in lockstep so the two responses are interchangeable.
 *   - "require this field"          → required rule
 *   - "between X and Y"             → range rule with parsed numbers
 *   - "must be (a) (valid) email"   → format rule with formatType=email
 *   - "flag if (the answer is) yes" → value_match warning
 *   - "must be a date in YYYY-MM-DD" → format rule with formatType=date_iso
 *
 * Anything else returns 0 rules + a helpful warning. NEVER throws.
 */

import { logger } from '../../../config/logger';
import { AiProvider, SuggestedRule } from '../types';

interface MockProviderOptions {
  /** Override modelId for tests that pin behavior to a specific tag. */
  modelId?: string;
}

export class MockAiProvider implements AiProvider {
  readonly providerName = 'mock' as const;
  readonly modelId: string;

  constructor(opts?: MockProviderOptions) {
    this.modelId = opts?.modelId || 'mock:v1';
  }

  /** Always available — no external dependency. */
  async ping(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }

  async generate(input: {
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
  }> {
    const startedAt = Date.now();
    try {
      const description = extractUserDescription(input.systemPrompt);
      const firstField = extractFirstAvailableField(input.systemPrompt);

      if (!description) {
        return {
          rules: [],
          warnings: ['mock: could not extract user description from system prompt'],
          inputTokens: estimateTokens(input.systemPrompt + input.userPrompt),
          outputTokens: 0,
          costUsd: 0,
          modelVersion: this.modelId,
        };
      }
      if (!firstField) {
        return {
          rules: [],
          warnings: ['mock: no fields in AVAILABLE FIELDS to target'],
          inputTokens: estimateTokens(input.systemPrompt + input.userPrompt),
          outputTokens: 0,
          costUsd: 0,
          modelVersion: this.modelId,
        };
      }

      const rules = buildRulesFromKeywords(description, firstField);

      logger.info('Mock AI provider generated rules', {
        correlationId: input.correlationId,
        modelId: this.modelId,
        rulesCount: rules.length,
        descriptionLength: description.length,
        latencyMs: Date.now() - startedAt,
      });

      return {
        rules,
        warnings: rules.length === 0 ? [
          'mock provider could not match description; recognized keywords: ' +
          '"require this field", "between X and Y", "must be an email", ' +
          '"flag if Yes", "must be a date in YYYY-MM-DD".'
        ] : [],
        // Token counts are estimates — they're used by the cost meter
        // and audit log; for the mock we just want them non-zero so the
        // dashboards don't render as "no usage".
        inputTokens: estimateTokens(input.systemPrompt + input.userPrompt),
        outputTokens: estimateTokens(JSON.stringify({ rules })),
        costUsd: 0,
        modelVersion: this.modelId,
      };
    } catch (err: any) {
      logger.warn('MockAiProvider.generate failed (this should be impossible)', {
        correlationId: input.correlationId,
        error: err?.message || String(err),
      });
      // Per the AiProvider contract we do NOT throw.
      return {
        rules: [],
        warnings: [`mock provider error (unexpected): ${err?.message || String(err)}`],
      };
    }
  }
}

/**
 * Pull the user description out of the system prompt. The orchestrator
 * wraps it in triple-pipes per the prompt template; we just look for
 * that delimited block.
 */
function extractUserDescription(systemPrompt: string): string {
  const m = systemPrompt.match(/\|\|\|\s*([\s\S]*?)\s*\|\|\|/);
  return m ? m[1].trim() : '';
}

interface MockTargetField {
  path: string;
  label: string;
  type: string;
  itemId: number;
}

/**
 * Pull the first entry out of the AVAILABLE FIELDS JSON block. We
 * intentionally don't parse the whole thing — the mock just needs ONE
 * valid target so the validator's `unknown_fieldPath` gate doesn't
 * reject everything.
 */
function extractFirstAvailableField(systemPrompt: string): MockTargetField | null {
  const fenceMatch = systemPrompt.match(/AVAILABLE FIELDS[\s\S]*?```json\s*([\s\S]*?)```/);
  if (!fenceMatch) return null;
  try {
    const arr = JSON.parse(fenceMatch[1]);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const f = arr[0];
    if (!f || typeof f.path !== 'string' || typeof f.itemId !== 'number') return null;
    return {
      path: f.path,
      label: typeof f.label === 'string' ? f.label : f.path,
      type: typeof f.type === 'string' ? f.type : 'text',
      itemId: f.itemId,
    };
  } catch {
    return null;
  }
}

/**
 * Map plain-English keywords to candidate rules. Mirrors the frontend
 * MockRuleSuggestionProvider so the two stay observably equivalent.
 */
function buildRulesFromKeywords(description: string, target: MockTargetField): SuggestedRule[] {
  const lower = description.toLowerCase();
  const rules: SuggestedRule[] = [];

  // ── 1: required ───────────────────────────────────────────────────
  const requiredRe =
    /\brequire this field\b|\bmake (this )?(field )?(it )?required\b|\b(is|should be|be) required\b|\brequired field\b|\bmust (be )?(filled|provided|entered)\b/i;
  if (requiredRe.test(lower)) {
    rules.push(buildRule(target, {
      ruleType: 'required',
      severity: 'error',
      errorMessage: `${target.label} is required`,
      rationale: 'Description requested making the field required.',
    }));
  }

  // ── 2: range ──────────────────────────────────────────────────────
  const rangeMatch =
    lower.match(/\bbetween\s+(-?\d+(?:\.\d+)?)\s+and\s+(-?\d+(?:\.\d+)?)\b/) ||
    lower.match(/\bfrom\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\b/);
  if (rangeMatch) {
    const minV = Number(rangeMatch[1]);
    const maxV = Number(rangeMatch[2]);
    if (!isNaN(minV) && !isNaN(maxV) && minV <= maxV) {
      rules.push(buildRule(target, {
        ruleType: 'range',
        severity: 'error',
        errorMessage: `Value must be between ${minV} and ${maxV}`,
        rationale: `Description specified a numeric range: ${minV} to ${maxV}.`,
        minValue: minV,
        maxValue: maxV,
      }));
    }
  }

  // ── 3: email ──────────────────────────────────────────────────────
  if (/\b(must be (a |an )?(valid )?email|email format|valid email address)\b/.test(lower)) {
    rules.push(buildRule(target, {
      ruleType: 'format',
      severity: 'error',
      errorMessage: 'Must be a valid email address',
      rationale: 'Description requested email format validation; matched the FORMAT_TYPE_REGISTRY "email" key.',
      formatType: 'email',
      selfTest: {
        shouldPass: ['user@example.com', 'first.last@example.co.uk', 'name+tag@subdomain.example.org'],
        shouldFail: ['not-an-email', 'a@', '@no-local.com'],
      },
    }));
  }

  // ── 4: flag if Yes (warning, value_match) ─────────────────────────
  if (/\b(flag if (the (response|answer) is )?yes|warn (when|if) (the (response|answer) is )?yes|highlight if yes)\b/.test(lower)) {
    rules.push(buildRule(target, {
      ruleType: 'value_match',
      severity: 'warning',
      errorMessage: 'This response is flagged for review (answer was "Yes")',
      rationale: 'Description requested a warning to fire when the response equals "Yes". value_match fires WHEN the value matches.',
      compareValue: 'Yes',
    }));
  }

  // ── 5: ISO date ───────────────────────────────────────────────────
  if (/\b(must be (a |an )?date(\s+in)?\s+(yyyy-mm-dd|iso (format)?)|iso date|format yyyy-mm-dd)\b/.test(lower)) {
    rules.push(buildRule(target, {
      ruleType: 'format',
      severity: 'error',
      errorMessage: 'Date must be in YYYY-MM-DD format',
      rationale: 'Description requested ISO date format.',
      formatType: 'date_iso',
      selfTest: {
        shouldPass: ['2025-01-15', '2024-12-31', '2023-06-01'],
        shouldFail: ['01/15/2025', 'not-a-date', '2024-13-01'],
      },
    }));
  }

  return rules;
}

function buildRule(
  target: MockTargetField,
  overrides: Partial<SuggestedRule> & Pick<SuggestedRule, 'ruleType' | 'severity' | 'errorMessage' | 'rationale'>,
): SuggestedRule {
  const safeLabel = (target.label || 'field').replace(/\s+/g, '_').toLowerCase();
  const base: SuggestedRule = {
    name: `ai_${overrides.ruleType}_${safeLabel}`.substring(0, 60),
    description: `AI-suggested ${overrides.ruleType} rule on "${target.label}"`,
    ruleType: overrides.ruleType,
    fieldPath: target.path,
    itemId: target.itemId,
    severity: overrides.severity,
    errorMessage: overrides.errorMessage,
    rationale: overrides.rationale,
  };
  return { ...base, ...overrides };
}

/**
 * Crude token estimate for the cost meter / audit log. ~4 chars per
 * token is the standard rule of thumb. Enough precision for an
 * "approximately how big was this prompt" line in the audit trail; do
 * not use for billing decisions (the mock has no real cost anyway).
 */
function estimateTokens(s: string): number {
  return Math.ceil((s?.length || 0) / 4);
}
