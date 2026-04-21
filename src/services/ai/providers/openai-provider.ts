/**
 * OpenAI Provider — Gate 2 of the AI rule-compiler.
 *
 * Uses the Chat Completions API with `response_format: json_schema +
 * strict:true`, which forces the model to emit JSON conforming to the
 * provided schema at the decoder layer. There is no parse step that can
 * fail mid-response; the model literally cannot emit invalid JSON for
 * the schema we send.
 *
 * Why Chat Completions and not the Responses API:
 *   - Both work, but `chat.completions` is the "supported indefinitely"
 *     surface (per OpenAI's own docs). For a clinical / regulated app
 *     we prefer the surface with the longest deprecation horizon.
 *   - Both surfaces expose the same `response_format` semantics.
 *
 * Cost / latency notes (April 2026):
 *   - GPT-4o ~ $2.50 / 1M input, $10.00 / 1M output. A 4 KB system
 *     prompt (~1k tokens) + 200 token field list + 50 token
 *     description ≈ 1.3k input tokens. Average response ≈ 800 output
 *     tokens. Per call ≈ $0.012. 20-call/hr cap per user => at most
 *     $0.24 / user / hr.
 *   - GPT-4o p50 latency ~ 4-7s; p95 ~ 15s. We hard-timeout at 30s.
 *
 * Defensive coding:
 *   - We catch ALL errors and convert them to the `ProviderError` shape
 *     so the orchestrator can fail-over to mock with a clear reason.
 *   - We never re-throw; the contract is "no throws for normal failure".
 */

import OpenAI from 'openai';
import { logger } from '../../../config/logger';
import { config } from '../../../config/environment';
import { AiProvider, SuggestedRule } from '../types';

interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  temperature: number;
}

export class OpenAIProvider implements AiProvider {
  readonly providerName = 'openai' as const;
  readonly modelId: string;
  private readonly client: OpenAI;
  private readonly temperature: number;
  private lastError: string | null = null;

  constructor(opts?: Partial<OpenAIProviderOptions>) {
    const apiKey = opts?.apiKey || config.ai.openaiApiKey;
    if (!apiKey) {
      // We allow construction without a key — `ping()` will then return
      // ok:false and the orchestrator will fail-over. Logging a warning
      // because a deploy that intends to use OpenAI but forgot the key
      // is a deployment misconfiguration we want to surface.
      logger.warn('OpenAIProvider constructed without an API key; ping() will return ok:false');
    }
    this.client = new OpenAI({
      apiKey: apiKey || 'sk-not-set',
      // 30-second per-request timeout matches the orchestrator's hard cap.
      timeout: 30_000,
      maxRetries: 1,
    });
    this.modelId = opts?.model || config.ai.openaiModel || 'gpt-4o-2024-11-20';
    this.temperature = opts?.temperature ?? config.ai.temperature ?? 0;
  }

  async ping(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.client.apiKey || this.client.apiKey === 'sk-not-set') {
      return { ok: false, reason: 'OPENAI_API_KEY not configured' };
    }
    if (this.lastError) {
      // If a prior call hit an auth error, surface it on the next ping
      // so the orchestrator can fail-over without trying the broken
      // provider again. Cleared on a successful generate().
      return { ok: false, reason: `last_error: ${this.lastError}` };
    }
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
      const completion = await this.client.chat.completions.create({
        model: this.modelId,
        // Determinism: temperature 0 + seed gives the most reproducible
        // outputs we can get from this surface. We pass the
        // correlationId as the seed so the same compile request yields
        // the same suggestions on retry.
        temperature: this.temperature,
        seed: hashSeed(input.correlationId),
        // Belt-and-suspenders cap on output size — the schema also
        // limits maxItems on the rules array. 16384 leaves headroom for
        // multi-rule responses with long custom regex patterns + self-tests
        // + rationale strings, so we don't truncate JSON mid-response.
        max_tokens: 16384,
        messages: [
          {
            role: 'system',
            content: input.systemPrompt,
          },
          {
            role: 'user',
            content: input.userPrompt,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'rule_compiler_output_v1',
            strict: false,
            schema: input.schema,
          },
        },
      });

      const choice = completion.choices?.[0];
      if (!choice || !choice.message?.content) {
        throw new Error('openai response had no message content');
      }

      let parsed: { rules?: SuggestedRule[]; _batchWarning?: string };
      try {
        parsed = JSON.parse(choice.message.content);
      } catch (err: any) {
        throw new Error(`openai response was not valid JSON: ${err?.message ?? 'unknown'}`);
      }

      const rules: SuggestedRule[] = Array.isArray(parsed.rules) ? parsed.rules : [];
      const warnings: string[] = [];
      if (typeof parsed._batchWarning === 'string' && parsed._batchWarning.length > 0) {
        warnings.push(parsed._batchWarning);
      }

      const usage = completion.usage;
      const inputTokens = usage?.prompt_tokens ?? undefined;
      const outputTokens = usage?.completion_tokens ?? undefined;
      const costUsd = estimateCost(this.modelId, inputTokens, outputTokens);

      // Reset the cached error after a successful call.
      this.lastError = null;

      logger.info('OpenAI compile succeeded', {
        correlationId: input.correlationId,
        modelId: this.modelId,
        inputTokens,
        outputTokens,
        costUsd,
        rulesCount: rules.length,
        latencyMs: Date.now() - startedAt,
      });

      return {
        rules,
        warnings,
        inputTokens,
        outputTokens,
        costUsd,
        modelVersion: completion.model,
      };
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      logger.warn('OpenAIProvider.generate failed', {
        correlationId: input.correlationId,
        error: this.lastError,
        latencyMs: Date.now() - startedAt,
      });
      // Per the AiProvider contract we do NOT throw — return zero rules
      // with a warning explaining what happened. The orchestrator
      // decides whether to retry, fail-over, or surface the error to
      // the user.
      return {
        rules: [],
        warnings: [`openai-provider error: ${this.lastError}`],
      };
    }
  }
}

/** Deterministic seed from a correlationId string. */
function hashSeed(s: string): number {
  // Simple FNV-1a 32-bit hash; OpenAI takes any positive 32-bit int.
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force into positive 31-bit range.
  return Math.abs(hash | 0);
}

/**
 * Cost estimator. Pricing as of April 2026; update when OpenAI changes
 * pricing pages. Returns USD; 0 on unknown models.
 */
function estimateCost(model: string, inputTokens?: number, outputTokens?: number): number {
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return 0;
  // Per-1M-token pricing.
  const PRICING: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-2024-11-20': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-5': { input: 10.0, output: 30.0 },
    'gpt-5.1': { input: 10.0, output: 30.0 },
    'gpt-5.2': { input: 10.0, output: 30.0 },
  };
  // Find the most specific match.
  let p = PRICING[model];
  if (!p) {
    // fall back to family prefix
    const family = Object.keys(PRICING).find(k => model.startsWith(k));
    if (family) p = PRICING[family];
  }
  if (!p) return 0;
  return ((inputTokens / 1_000_000) * p.input) + ((outputTokens / 1_000_000) * p.output);
}
