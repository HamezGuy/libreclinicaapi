/**
 * Gemini Provider — Gate 2 of the AI rule-compiler (alternative).
 *
 * Uses `@google/genai` v1 (Gemini Developer API). We use the
 * `responseJsonSchema` config which accepts the same JSON Schema we
 * send to OpenAI — this keeps a single schema file that works for both
 * providers (per AI_VALIDATION_RULE_COMPILER.md §6.2).
 *
 * Why both providers exist:
 *   - Operator chooses via `AI_COMPILER_PROVIDER=openai|gemini`.
 *   - Failover (orchestrator can call the other on failure).
 *   - A/B testing accuracy on the eval suite.
 *   - Different procurement paths (some customers have only Vertex AI
 *     / Google Cloud BAA available; some only OpenAI).
 *
 * The Gemini SDK is ESM by default; @google/genai 1.x publishes a CJS
 * shim under `./dist/node/index.cjs` so `require('@google/genai')`
 * works from our commonjs backend. Do NOT switch to dynamic
 * import — it would change the orchestrator's await-shape and the
 * cost is minor.
 */

import { logger } from '../../../config/logger';
import { config } from '../../../config/environment';
import { AiProvider, SuggestedRule } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const genaiModule = require('@google/genai') as typeof import('@google/genai');
const { GoogleGenAI } = genaiModule;

interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  temperature: number;
}

export class GeminiProvider implements AiProvider {
  readonly providerName = 'gemini' as const;
  readonly modelId: string;
  private readonly client: InstanceType<typeof GoogleGenAI>;
  private readonly temperature: number;
  private lastError: string | null = null;

  constructor(opts?: Partial<GeminiProviderOptions>) {
    const apiKey = opts?.apiKey || config.ai.geminiApiKey;
    if (!apiKey) {
      logger.warn('GeminiProvider constructed without an API key; ping() will return ok:false');
    }
    this.client = new GoogleGenAI({ apiKey: apiKey || 'gemini-not-set' });
    this.modelId = opts?.model || config.ai.geminiModel || 'gemini-2.5-pro';
    this.temperature = opts?.temperature ?? config.ai.temperature ?? 0;
  }

  async ping(): Promise<{ ok: boolean; reason?: string }> {
    if (!config.ai.geminiApiKey) {
      return { ok: false, reason: 'GEMINI_API_KEY not configured' };
    }
    if (this.lastError) {
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
      // Gemini's responseJsonSchema is a recent feature (v1.50+ of the
      // SDK). We send the same JSON Schema we send OpenAI; the SDK
      // forwards it verbatim to the Gemini backend which constrains
      // decoding the same way.
      // Per-model thinking-budget caps:
      //   gemini-2.5-pro       — thinking is REQUIRED; min budget is 128.
      //                          Returns 400 INVALID_ARGUMENT on budget=0.
      //   gemini-2.5-flash     — thinking optional; budget=0 disables it.
      //   gemini-2.5-flash-lite— ignores thinkingConfig entirely.
      // Constrained-JSON generation doesn't benefit much from internal
      // thinking (the schema does the constraining), so we cap it tight
      // on Pro and disable on Flash. This is a meaningful cost / latency
      // win at no quality loss for our use case (the validator's
      // selfTest gate catches any LLM mistake anyway).
      const thinkingBudget = /pro/i.test(this.modelId) ? 128 : 0;
      const response = await this.client.models.generateContent({
        model: this.modelId,
        contents: [
          {
            role: 'user',
            parts: [{ text: input.systemPrompt + '\n\n' + input.userPrompt }],
          },
        ],
        config: {
          temperature: this.temperature,
          responseMimeType: 'application/json',
          // responseJsonSchema accepts a raw JSON Schema; preferred over
          // responseSchema for our use case (responseSchema uses Gemini's
          // own simplified schema dialect, which would mean maintaining
          // two schemas).
          responseJsonSchema: input.schema,
          // 16384 leaves generous headroom for:
          //   - Multi-rule responses (up to AI_COMPILER_MAX_RULES_HARD_CAP
          //     rules × ~250 tokens each ≈ 5,000 visible tokens for a
          //     full batch).
          //   - Long custom regex patterns + selfTest examples (~2,000 tokens).
          //   - Mandatory thinking budget on Gemini 2.5-pro (up to ~8,000
          //     thinking tokens for complex prompts).
          //   - Long rationale fields (the model's reasoning for each rule).
          // Tighter caps caused empty/truncated JSON on complex prompts.
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingBudget },
        },
      });

      const text = response?.text;
      if (typeof text !== 'string' || text.length === 0) {
        throw new Error('gemini response had no text content');
      }

      let parsed: { rules?: SuggestedRule[]; _batchWarning?: string };
      try {
        parsed = JSON.parse(text);
      } catch (err: any) {
        throw new Error(`gemini response was not valid JSON: ${err?.message ?? 'unknown'}`);
      }

      // Optional debug — set AI_DEBUG_RAW=true to log Gemini's raw JSON to
      // stderr. Useful when the validator rejects a rule and you want to
      // see exactly which field the model dropped. Off in production.
      if (process.env.AI_DEBUG_RAW === 'true') {
        // eslint-disable-next-line no-console
        console.error('[GEMINI RAW]', JSON.stringify(parsed, null, 2));
      }

      const rules: SuggestedRule[] = Array.isArray(parsed.rules) ? parsed.rules : [];
      const warnings: string[] = [];
      if (typeof parsed._batchWarning === 'string' && parsed._batchWarning.length > 0) {
        warnings.push(parsed._batchWarning);
      }

      const usage = response?.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? undefined;
      // For Gemini 2.5 Pro/Flash, "thinking" tokens count toward output
      // billing. With thinkingBudget=0 above this is normally 0, but we
      // include it defensively so the cost meter never under-reports.
      const candidatesTokens = usage?.candidatesTokenCount ?? 0;
      const thoughtsTokens = (usage as any)?.thoughtsTokenCount ?? 0;
      const outputTokens = (candidatesTokens + thoughtsTokens) || undefined;
      const costUsd = estimateCost(this.modelId, inputTokens, outputTokens);

      this.lastError = null;
      logger.info('Gemini compile succeeded', {
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
        modelVersion: response?.modelVersion ?? this.modelId,
      };
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      logger.warn('GeminiProvider.generate failed', {
        correlationId: input.correlationId,
        error: this.lastError,
        latencyMs: Date.now() - startedAt,
      });
      return {
        rules: [],
        warnings: [`gemini-provider error: ${this.lastError}`],
      };
    }
  }
}

/**
 * Cost estimator. Pricing as of April 2026.
 */
function estimateCost(model: string, inputTokens?: number, outputTokens?: number): number {
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return 0;
  const PRICING: Record<string, { input: number; output: number }> = {
    // per 1M tokens
    'gemini-2.5-pro': { input: 1.25, output: 10.0 },
    'gemini-2.5-flash': { input: 0.075, output: 0.3 },
    'gemini-2.5-flash-lite': { input: 0.05, output: 0.2 },
  };
  let p = PRICING[model];
  if (!p) {
    const family = Object.keys(PRICING).find(k => model.startsWith(k));
    if (family) p = PRICING[family];
  }
  if (!p) return 0;
  return ((inputTokens / 1_000_000) * p.input) + ((outputTokens / 1_000_000) * p.output);
}
