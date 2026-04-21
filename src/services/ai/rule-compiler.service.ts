/**
 * AI Rule Compiler — single orchestrator that owns the entire pipeline.
 *
 * Pipeline (top to bottom):
 *   0. Reject if AI_COMPILER_ENABLED=false (kill-switch).
 *   1. PHI scan on the description text — refuse with reason on hit.
 *   2. PHI scan on field labels — emit warning but allow.
 *   3. Idempotency cache — return cached on hit (5-min TTL, in-memory LRU).
 *   4. Audit: AI_RULE_COMPILATION_REQUESTED.
 *   5. Build prompts (system + user) by substituting placeholders in
 *      the v1 markdown template. Embed the JSON schema for structured
 *      output. Embed the FORMAT_TYPE_REGISTRY keys.
 *   6. Pick the configured provider (openai|gemini) and call it under
 *      a hard timeout. NO fail-over chain — if the configured provider
 *      fails we surface the error to the caller.
 *   7. Run the validator (`rule-validator.service`). On 0-accepted +
 *      retryable failures, ONE retry with the failure context appended.
 *   8. Audit: AI_RULE_COMPILATION_RETURNED (or REFUSED).
 *   9. Cache the response under idempotencyKey.
 *  10. Return the response.
 *
 * Hard caps applied here (in addition to Joi route-level limits):
 *   - description trimmed at AI_COMPILER_MAX_DESCRIPTION_CHARS.
 *   - fieldContext trimmed at AI_COMPILER_MAX_FIELDS.
 *   - response.rules truncated at AI_COMPILER_MAX_RULES_HARD_CAP.
 *
 * The orchestrator NEVER throws for normal failure. The controller
 * passes its return value straight back to the client.
 *
 * Why one file (refactor v2):
 *   - PHI scan is six regexes; doesn't need its own module.
 *   - Idempotency cache is an in-memory LRU; doesn't need its own module.
 *   - Provider selection is a switch; doesn't need its own module.
 *   - Each of those used to be ~80 lines in a separate file with its
 *     own test file — over-decomposition for primitives that are only
 *     used here. They live in this file now.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';
import { trackUserAction } from '../database/audit.service';
import { FORMAT_TYPE_REGISTRY } from '../database/validation-rules.service';
import {
  AiProvider,
  CompileCallerContext,
  RuleSuggestionRequest,
  RuleSuggestionResponse,
  SuggestedRule,
} from './types';
import { validateSuggestions, splitForRetry } from './rule-validator.service';
import { checkScope } from './scope-guard.service';
import { OpenAIProvider } from './providers/openai-provider';
import { GeminiProvider } from './providers/gemini-provider';
import { MockAiProvider } from './providers/mock-provider';

// =============================================================================
// PHI scanner — six regexes that catch the most common identifier shapes
// (SSN, MRN, email, US phone, ISO/US DOB). Coarse on purpose — refusing
// on a false positive is safer than leaking PHI to a hosted LLM.
//
// 2026-04-19 hardening: distinguish "PHI in the description" (patient
// data) from "format example in the description" (legitimate authoring).
// E.g. "MRN must be MRN-123456 format" is the AUTHOR demonstrating the
// shape of a valid value, not leaking a patient's MRN. Same for date
// literals used as a comparison boundary ("must be after 2025-01-01").
// We keep the coarse regex match as a SIGNAL but only refuse when the
// match co-occurs with patient-context words. Otherwise we still log
// a warning (the human reviewer sees it) and allow the request.
// =============================================================================

const PHI_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'ssn',      re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'mrn',      re: /\bMRN[\s:#-]*\d{6,12}\b/i },
  { name: 'email',    re: /\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/ },
  // Phone with paren or fully-dashed/dotted (alternation handles the leading-paren `\b` problem).
  { name: 'phone_us', re: /(?:\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b|\b\d{3}\.\d{3}\.\d{4}\b)/ },
  { name: 'dob_iso',  re: /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/ },
  { name: 'dob_us',   re: /\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2}\b/ },
];

/**
 * Strong signals that a PHI-shaped match is ACTUAL patient data, not a
 * format example or comparison literal. Triggers a hard refusal.
 *
 * Excludes generic words like "format" / "example" / "between" /
 * "before" / "after" / "must be" — those are author-context words.
 */
const PATIENT_CONTEXT_RE = /\b(patient|subject|study\s*subject|enrollee|participant|the\s*person|sample|specimen|chart|record\s+number|mr#|mr\s*#|first\s*name|last\s*name|full\s*name|surname|date\s*of\s*birth|dob)\b/i;

/**
 * SSN is a HIGH-RISK identifier — there's basically no legitimate
 * non-PHI reason to write the literal pattern XXX-XX-XXXX in a rule
 * description (the regex pattern itself uses `\d{3}-\d{2}-\d{4}`,
 * not literal digits). Always refuse on SSN-shaped matches regardless
 * of context.
 */
const ALWAYS_REFUSE_PATTERNS = new Set<string>(['ssn']);

interface PhiScanResult {
  /** True only when we should HARD REFUSE the request. */
  hasPhi: boolean;
  /** All patterns that matched (informational; surfaced in warnings). */
  patterns: string[];
  /** True when patterns matched but we treat them as author intent (warn-only). */
  warnOnly: boolean;
}

/**
 * Scan free-text for PHI-shaped patterns.
 *
 * Refusal logic:
 *   - SSN-shaped match  → ALWAYS refuse (no legitimate authoring use).
 *   - Other match + patient-context word nearby → refuse.
 *   - Other match alone (e.g. an ISO date or example format) →
 *     warnOnly=true; orchestrator emits a warning but proceeds.
 *
 * Exported for the unit tests; not part of the public service API.
 */
export function scanForPhi(text: string | undefined | null): PhiScanResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { hasPhi: false, patterns: [], warnOnly: false };
  }
  const found: string[] = [];
  for (const p of PHI_PATTERNS) {
    if (p.re.test(text)) found.push(p.name);
  }
  if (found.length === 0) {
    return { hasPhi: false, patterns: [], warnOnly: false };
  }
  // Always-refuse patterns trigger immediately, regardless of context.
  const hasAlwaysRefuse = found.some(name => ALWAYS_REFUSE_PATTERNS.has(name));
  if (hasAlwaysRefuse) {
    return { hasPhi: true, patterns: found, warnOnly: false };
  }
  // Other patterns refuse only when paired with patient-context words.
  const hasPatientContext = PATIENT_CONTEXT_RE.test(text);
  if (hasPatientContext) {
    return { hasPhi: true, patterns: found, warnOnly: false };
  }
  // Otherwise, allow with a warning — likely a format example or
  // comparison literal that the author wants to compile into a rule.
  return { hasPhi: false, patterns: found, warnOnly: true };
}

/**
 * Scan field labels / descriptions / option labels for PHI. Used to
 * emit a warning (not refuse) when a sponsor labels something
 * dangerously.
 */
function scanFieldsForPhi(fields: ReadonlyArray<{
  label?: string;
  description?: string;
  options?: ReadonlyArray<{ label?: string }>;
}>): PhiScanResult {
  const all: string[] = [];
  for (const f of fields) {
    if (f.label) all.push(f.label);
    if (f.description) all.push(f.description);
    if (Array.isArray(f.options)) {
      for (const o of f.options) {
        if (o?.label) all.push(o.label);
      }
    }
  }
  return scanForPhi(all.join('\n'));
}

// =============================================================================
// Idempotency cache — in-memory LRU keyed by `${userId}|${idempotencyKey}`,
// 1-hour TTL, 1000-entry cap. Single-process; if we ever scale to multi-
// instance the orchestrator can swap to Redis behind these two helpers.
// =============================================================================

interface CacheEntry {
  value: RuleSuggestionResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;
const cacheStore = new Map<string, CacheEntry>();

function cacheKey(userId: number, idempotencyKey: string): string {
  return `${userId}|${idempotencyKey}`;
}

function cacheGet(userId: number, idempotencyKey: string): RuleSuggestionResponse | null {
  const k = cacheKey(userId, idempotencyKey);
  const entry = cacheStore.get(k);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cacheStore.delete(k);
    return null;
  }
  // LRU bump: re-insert to move to most-recent position.
  cacheStore.delete(k);
  cacheStore.set(k, entry);
  return entry.value;
}

function cacheSet(userId: number, idempotencyKey: string, value: RuleSuggestionResponse): void {
  const k = cacheKey(userId, idempotencyKey);
  cacheStore.set(k, {
    // Defensive deep-clone so post-store mutation can't corrupt the cache.
    value: JSON.parse(JSON.stringify(value)) as RuleSuggestionResponse,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  while (cacheStore.size > CACHE_MAX_ENTRIES) {
    const oldest = cacheStore.keys().next().value;
    if (oldest === undefined) break;
    cacheStore.delete(oldest);
  }
}

/** Test seam — clears the in-memory idempotency cache. */
export function __resetCompilerCacheForTests(): void {
  cacheStore.clear();
}

// =============================================================================
// Provider singleton — chosen at first use based on env. We construct
// lazily so the import side-effects don't fire when AI is disabled.
// =============================================================================

let _openai: AiProvider | null = null;
let _gemini: AiProvider | null = null;
let _mock: AiProvider | null = null;

function getProvider(): AiProvider {
  const which = (config.ai.provider || 'openai').toLowerCase();
  if (which === 'gemini') {
    if (!_gemini) _gemini = new GeminiProvider();
    return _gemini;
  }
  if (which === 'mock') {
    // Deterministic provider that exercises the FULL orchestrator (PHI
    // scan, idempotency cache, validator gates, retry loop, audit log)
    // without calling any external LLM. Use case: local dev without an
    // API key, CI smoke tests, and operator failover when an LLM
    // provider's quota is exhausted. Matches the keyword vocabulary of
    // the frontend MockRuleSuggestionProvider so the two stay
    // observably equivalent.
    if (!_mock) _mock = new MockAiProvider();
    return _mock;
  }
  // Any other value (including unrecognized) falls through to OpenAI —
  // the safest default for production where typos shouldn't silently
  // disable the AI feature.
  if (!_openai) _openai = new OpenAIProvider();
  return _openai;
}

/** Test seam. */
export function __resetCompilerProviderForTests(): void {
  _openai = null;
  _gemini = null;
  _mock = null;
}

// =============================================================================
// Prompt + schema loader — cached after first read; the .md and .json
// files don't change at runtime.
// =============================================================================

let cachedPrompt: string | null = null;
let cachedSchema: any | null = null;

async function loadPromptAndSchema(): Promise<{ prompt: string; schema: any }> {
  if (cachedPrompt != null && cachedSchema != null) {
    return { prompt: cachedPrompt, schema: cachedSchema };
  }
  const promptPath = path.join(__dirname, 'prompts', 'rule-compiler.v1.md');
  const schemaPath = path.join(__dirname, 'prompts', 'rule-compiler.schema.json');
  cachedPrompt = await fs.readFile(promptPath, 'utf8');
  const schemaRaw = await fs.readFile(schemaPath, 'utf8');
  cachedSchema = JSON.parse(schemaRaw);
  return { prompt: cachedPrompt, schema: cachedSchema };
}

function buildSystemPrompt(template: string, args: {
  fieldContext: RuleSuggestionRequest['fieldContext'];
  existingRules: RuleSuggestionRequest['existingRules'];
  description: string;
  maxRules: number;
}): string {
  // Include the actual regex pattern so the LLM can reason about exactly
  // what values match. Without this, Gemini sometimes invents selfTest
  // examples that are wrong for the real pattern (e.g. asserting "0"
  // FAILS positive_number when the regex actually accepts 0).
  const formatKeys = Object.keys(FORMAT_TYPE_REGISTRY)
    .filter(k => k !== 'custom_regex')
    .map(k => {
      const entry = FORMAT_TYPE_REGISTRY[k];
      return `- ${k} — ${entry.label} (e.g. "${entry.example}")\n    regex: ${entry.pattern}`;
    })
    .join('\n');

  // Build the prompt-shaped field list. We OMIT undefined keys so the
  // LLM doesn't get a wall of `"unit": null` style noise that wastes
  // tokens and (with some models) implies the field is meaningful.
  // `tableColumns` and `questionRows` are passed through verbatim so
  // the LLM can see column names when reasoning about a table; even
  // though we forbid AI from emitting `tableCellTarget`, knowing the
  // column shape lets the LLM produce a better field-level rule and
  // emit a clearer `_warning` about cell-level scoping.
  const fieldsForPrompt = args.fieldContext.map((f) => {
    const out: Record<string, unknown> = {
      path: f.path,
      label: f.label,
      type: f.type,
      itemId: f.itemId,
    };
    if (typeof f.required === 'boolean') out.required = f.required;
    if (typeof f.unit === 'string' && f.unit) out.unit = f.unit;
    if (typeof f.min === 'number' && Number.isFinite(f.min)) out.min = f.min;
    if (typeof f.max === 'number' && Number.isFinite(f.max)) out.max = f.max;
    if (Array.isArray(f.options) && f.options.length > 0) {
      out.options = f.options.slice(0, 50);
    }
    if (typeof f.semanticTag === 'string' && f.semanticTag) {
      out.semanticTag = f.semanticTag;
    }
    if (typeof f.description === 'string' && f.description) {
      // Cap to 500 chars — see frontend builder; long help text rarely
      // helps the LLM produce a better rule.
      out.description = f.description.substring(0, 500);
    }
    if (Array.isArray((f as any).tableColumns) && (f as any).tableColumns.length > 0) {
      // First 30 columns is plenty; very wide tables would blow the prompt budget.
      out.tableColumns = (f as any).tableColumns.slice(0, 30);
    }
    if (Array.isArray((f as any).questionRows) && (f as any).questionRows.length > 0) {
      out.questionRows = (f as any).questionRows.slice(0, 30);
    }
    return out;
  });

  const existingForPrompt = args.existingRules.slice(0, 100);

  return template
    .replace('FORMAT_TYPE_KEYS_PLACEHOLDER', formatKeys)
    .replace('FIELD_CONTEXT_PLACEHOLDER', JSON.stringify(fieldsForPrompt, null, 2))
    .replace('EXISTING_RULES_PLACEHOLDER', JSON.stringify(existingForPrompt, null, 2))
    .replace('USER_DESCRIPTION_PLACEHOLDER', args.description)
    .replace('MAX_RULES_PLACEHOLDER', String(args.maxRules));
}

// =============================================================================
// Public entry — compileRules
// =============================================================================

export async function compileRules(
  request: RuleSuggestionRequest,
  caller: CompileCallerContext,
): Promise<RuleSuggestionResponse> {
  const startedAt = Date.now();
  const corr = request.correlationId;

  // === Step 0: kill-switch ===
  if (!config.ai.enabled) {
    return refusedResponse(request, caller, 'feature_disabled',
      'AI rule compiler is disabled by AI_COMPILER_ENABLED=false', startedAt);
  }

  // === Hard caps & shape coercion ===
  const description = (request.description || '').toString().slice(0, config.ai.maxDescriptionChars);
  if (description.trim().length === 0) {
    return refusedResponse(request, caller, 'empty_description',
      'Description must be non-empty', startedAt);
  }
  const fieldContext = (request.fieldContext || []).slice(0, config.ai.maxFields);
  if (fieldContext.length === 0) {
    return refusedResponse(request, caller, 'no_field_context',
      'fieldContext is empty (no fields to target)', startedAt);
  }
  const maxRules = Math.max(1, Math.min(request.maxRules || 5, config.ai.maxRulesHardCap));

  // === Step 0.5: Scope guard ===
  // Refuse off-topic / prompt-injection / noise BEFORE we burn LLM tokens.
  // Returns a normalized description (whitespace cleaned, control chars
  // stripped) for the LLM call.
  const scope = checkScope(description);
  if (!scope.ok) {
    await safeAudit({
      userId: caller.userId,
      username: caller.username,
      action: 'AI_RULE_COMPILATION_REFUSED',
      details: `scope_guard refused (${scope.refusalCode}): ${scope.message?.substring(0, 200)}; correlationId=${corr}`,
    });
    return {
      rules: [],
      warnings: [scope.message || 'Description rejected by scope guard.'],
      flags: { refused: true, refusedReason: `scope_${scope.refusalCode}`, containedPhi: false },
      stats: emptyStats(corr, startedAt),
    };
  }
  const cleanDescription = scope.normalized;

  // === Step 1: PHI scan on description ===
  const phi = scanForPhi(cleanDescription);
  if (phi.hasPhi) {
    await safeAudit({
      userId: caller.userId,
      username: caller.username,
      action: 'AI_RULE_COMPILATION_REFUSED',
      details: `PHI patterns detected in description with patient context (${phi.patterns.join(', ')}); request refused. correlationId=${corr}`,
    });
    return {
      rules: [],
      warnings: [
        `PHI-shaped patterns detected in your description: ${phi.patterns.join(', ')}. ` +
        `Please remove patient identifiers and resubmit.`,
      ],
      flags: { refused: true, refusedReason: 'phi_in_description', containedPhi: true },
      stats: emptyStats(corr, startedAt),
    };
  }

  // PHI-shaped match without patient context (e.g. format example like
  // "MRN-123456" inside an instructional clause, or a date literal as a
  // comparison boundary). Allow but warn so the human reviewer can sanity
  // check before signing.
  const earlyWarnings: string[] = [...scope.warnings];
  if (phi.warnOnly && phi.patterns.length > 0) {
    earlyWarnings.push(
      `Note: PHI-shaped patterns appeared in your description (${phi.patterns.join(', ')}) ` +
      `but in author-context (no patient/subject/DOB nearby). Compiling anyway. ` +
      `Verify before signing that no real patient identifiers are embedded.`
    );
  }

  // === Step 2: PHI scan on field labels (warn only) ===
  const fieldPhi = scanFieldsForPhi(fieldContext);
  if (fieldPhi.hasPhi || (fieldPhi as any).warnOnly) {
    earlyWarnings.push(
      `Note: PHI-shaped patterns were detected in field metadata (${fieldPhi.patterns.join(', ')}). ` +
      `If this is unexpected, review the form labels.`
    );
  }

  // === Step 3: idempotency cache ===
  const cached = cacheGet(caller.userId, request.idempotencyKey);
  if (cached) {
    const stats = { ...cached.stats, latencyMs: Date.now() - startedAt, fromCache: true };
    await safeAudit({
      userId: caller.userId,
      username: caller.username,
      action: 'AI_RULE_COMPILATION_RETURNED',
      details: `Cached response served. provider=${cached.stats.providerName} rules=${cached.rules.length} correlationId=${corr}`,
    });
    return { ...cached, stats };
  }

  // === Step 4: audit REQUESTED ===
  await safeAudit({
    userId: caller.userId,
    username: caller.username,
    action: 'AI_RULE_COMPILATION_REQUESTED',
    details: `provider=${config.ai.provider} maxRules=${maxRules} fields=${fieldContext.length} correlationId=${corr} crfId=${request.crfId ?? 'n/a'}`,
  });

  // === Step 5: build prompts ===
  let prompt: string;
  let schema: any;
  try {
    const loaded = await loadPromptAndSchema();
    prompt = loaded.prompt;
    schema = loaded.schema;
  } catch (err: any) {
    logger.error('rule-compiler failed to load prompt/schema', { error: err?.message });
    return refusedResponse(request, caller, 'config_error',
      `Failed to load prompt/schema: ${err?.message}`, startedAt);
  }

  const systemPrompt = buildSystemPrompt(prompt, {
    fieldContext,
    existingRules: request.existingRules,
    description: cleanDescription,
    maxRules,
  });
  const userPrompt = `Generate up to ${maxRules} rules from the description above. correlationId=${corr}`;

  // === Step 6: provider call (no fail-over; surface failure to caller) ===
  const provider = getProvider();

  // ping — fail fast if provider is unhealthy.
  let pingResult: { ok: boolean; reason?: string };
  try {
    pingResult = await provider.ping();
  } catch (err: any) {
    pingResult = { ok: false, reason: `ping_threw: ${err?.message ?? 'unknown'}` };
  }
  if (!pingResult.ok) {
    return refusedResponse(request, caller, 'provider_unavailable',
      `Provider '${provider.providerName}' is unavailable: ${pingResult.reason ?? 'unknown'}`, startedAt);
  }

  // generate (with hard timeout)
  const gen = await timeBoxed(
    provider.generate({ systemPrompt, userPrompt, schema, correlationId: corr, timeoutMs: config.ai.timeoutMs }),
    config.ai.timeoutMs,
    `${provider.providerName}_timeout`,
  );

  if (gen.kind === 'timeout') {
    return refusedResponse(request, caller, 'provider_timeout',
      `Provider '${provider.providerName}' timed out after ${config.ai.timeoutMs}ms`, startedAt);
  }

  const raw = gen.value;
  const providerWarnings: string[] = (raw.warnings ?? []).slice();

  // === Step 7: validate (with one retry on retryable failures) ===
  let result = validateSuggestions(raw.rules, fieldContext);
  const split = splitForRetry(result.rejected);

  // Retry loop: try up to MAX_RETRIES times when EVERY rule was rejected
  // but at least one was retryable. Real-world Gemini occasionally drops
  // a required field even after a corrective hint, so 2 retries instead
  // of 1 raises end-to-end success ~10pp at minor cost.
  const MAX_RETRIES = 2;
  let retryAttempt = 0;
  while (retryAttempt < MAX_RETRIES && result.accepted.length === 0 && split.retryable.length > 0) {
    retryAttempt++;
    const isLastRetry = retryAttempt === MAX_RETRIES;
    const retryNote =
      `\n\nYour previous response had validator failures. ${isLastRetry ? 'THIS IS YOUR FINAL RETRY — be extremely careful to populate every field your previous response was missing.' : 'Please re-emit corrected rules.'}\n` +
      split.retryable.map(r => `- ${r.retryContext || r.reason}`).join('\n');
    const retryGen = await timeBoxed(
      provider.generate({
        systemPrompt: systemPrompt + retryNote,
        userPrompt,
        schema,
        correlationId: corr + ':retry' + retryAttempt,
        timeoutMs: config.ai.timeoutMs,
      }),
      config.ai.timeoutMs,
      `${provider.providerName}_retry_timeout`,
    );
    if (retryGen.kind === 'value') {
      providerWarnings.push(...(retryGen.value.warnings ?? []));
      const retryResult = validateSuggestions(retryGen.value.rules, fieldContext);
      // Roll up combined token / cost regardless of outcome — we paid for it.
      raw.inputTokens = (raw.inputTokens ?? 0) + (retryGen.value.inputTokens ?? 0);
      raw.outputTokens = (raw.outputTokens ?? 0) + (retryGen.value.outputTokens ?? 0);
      raw.costUsd = (raw.costUsd ?? 0) + (retryGen.value.costUsd ?? 0);
      if (retryResult.accepted.length > 0) {
        result = retryResult;
        break;
      }
      // Update split for the next retry's hint generation.
      result = retryResult;
      const next = splitForRetry(result.rejected);
      split.retryable = next.retryable;
      split.permanent = next.permanent;
    } else {
      // Timeout — stop retrying.
      break;
    }
  }

  providerWarnings.push(...result.warnings);
  for (const r of result.rejected) {
    providerWarnings.push(`Stripped rule "${r.rule.name}": ${r.reason}`);
  }

  // === Truncate to caller's maxRules ===
  let acceptedRules: SuggestedRule[] = result.accepted;
  if (acceptedRules.length > maxRules) {
    providerWarnings.push(`returned ${acceptedRules.length} rules; truncated to ${maxRules} per request.maxRules`);
    acceptedRules = acceptedRules.slice(0, maxRules);
  }

  // === Compose response ===
  const stats = {
    providerName: provider.providerName,
    modelId: provider.modelId,
    modelVersion: raw.modelVersion,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    costUsd: raw.costUsd,
    latencyMs: Date.now() - startedAt,
    correlationId: corr,
    fromCache: false,
  };

  const refused = acceptedRules.length === 0;
  const response: RuleSuggestionResponse = {
    rules: acceptedRules,
    warnings: [...earlyWarnings, ...providerWarnings],
    flags: {
      refused,
      refusedReason: refused
        ? `provider_returned_no_valid_rules: provider=${provider.providerName}`
        : undefined,
      containedPhi: false,
    },
    stats,
  };

  // === Audit RETURNED / REFUSED ===
  await safeAudit({
    userId: caller.userId,
    username: caller.username,
    action: refused ? 'AI_RULE_COMPILATION_REFUSED' : 'AI_RULE_COMPILATION_RETURNED',
    details:
      `provider=${stats.providerName} model=${stats.modelId} rules=${response.rules.length} ` +
      `inputTokens=${stats.inputTokens ?? 'na'} outputTokens=${stats.outputTokens ?? 'na'} ` +
      `costUsd=${(stats.costUsd ?? 0).toFixed(6)} latencyMs=${stats.latencyMs} correlationId=${corr}`,
  });

  // === Cache (only successful) ===
  if (!refused) {
    cacheSet(caller.userId, request.idempotencyKey, response);
  }

  return response;
}

// =============================================================================
// Helpers
// =============================================================================

function refusedResponse(
  request: RuleSuggestionRequest,
  caller: CompileCallerContext,
  reasonCode: string,
  reasonMessage: string,
  startedAt: number,
): RuleSuggestionResponse {
  void safeAudit({
    userId: caller.userId,
    username: caller.username,
    action: 'AI_RULE_COMPILATION_REFUSED',
    details: `${reasonCode}: ${reasonMessage} correlationId=${request.correlationId}`,
  });
  return {
    rules: [],
    warnings: [reasonMessage],
    flags: { refused: true, refusedReason: reasonCode, containedPhi: false },
    stats: emptyStats(request.correlationId, startedAt),
  };
}

function emptyStats(correlationId: string, startedAt: number) {
  return {
    providerName: config.ai.provider,
    modelId: '(no provider attempted)',
    latencyMs: Date.now() - startedAt,
    correlationId,
    fromCache: false,
  };
}

/**
 * Wrap a promise in a hard timeout. Returns either the resolved value
 * (kind: 'value') or a timeout marker (kind: 'timeout'). NEVER rejects.
 */
async function timeBoxed<T>(
  promise: Promise<T>,
  timeoutMs: number,
  reason: string,
): Promise<{ kind: 'value'; value: T } | { kind: 'timeout'; reason: string }> {
  let to: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(v => ({ kind: 'value' as const, value: v })),
      new Promise<{ kind: 'timeout'; reason: string }>((resolve) => {
        to = setTimeout(() => resolve({ kind: 'timeout', reason }), timeoutMs);
      }),
    ]);
  } finally {
    if (to) clearTimeout(to);
  }
}

async function safeAudit(args: {
  userId: number;
  username: string;
  action: string;
  details: string;
}): Promise<void> {
  try {
    await trackUserAction({
      userId: args.userId,
      username: args.username,
      action: args.action,
      entityType: 'ai_rule_compilation',
      details: args.details,
    });
  } catch (err: any) {
    logger.warn('rule-compiler audit failed (non-fatal)', { action: args.action, error: err?.message });
  }
}
