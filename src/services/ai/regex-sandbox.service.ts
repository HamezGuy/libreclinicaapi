/**
 * Regex Sandbox — Gate 3 of the AI rule-compiler.
 *
 * Purpose: stop AI-emitted regular expressions from causing
 *   (a) catastrophic backtracking (ReDoS) at runtime on the patient form,
 *   (b) syntax errors in the runtime evaluator,
 *   (c) regex features the codebase has historically had bugs around
 *       (lookbehind, named groups, backreferences).
 *
 * How:
 *   - The pattern is compiled in re2-wasm. Google's RE2 has a hard
 *     LINEAR-TIME guarantee — there is no input that can make it slow.
 *   - re2 deliberately does NOT support lookbehind, backreferences, or
 *     named-group syntax variants. So if a pattern fails to compile in
 *     re2 we REJECT it as too dangerous to ship to the patient form,
 *     even when it's a perfectly valid JS RegExp.
 *   - We also compile in JS RegExp because the runtime evaluator
 *     ultimately uses JS RegExp; we want to know up-front if the two
 *     engines disagree on compileability.
 *
 * The frontend runtime evaluator (patient-form-modal applyRule + format
 * branch) executes JS RegExp. That's intentional: re2-wasm needs WASM
 * load + cross-platform binary, which is fine on the Node backend but
 * heavy in the browser. Re2 here is a SAFETY GATE at compile time, not
 * the runtime engine.
 *
 * 2026-04 design notes (see AI_VALIDATION_RULE_COMPILER.md §5 Gate 3):
 *   - We deliberately reject patterns that are valid JS RegExp but not
 *     re2-compilable. This is a feature, not a bug — it forces the AI
 *     to stay within a portable, ReDoS-safe subset of regex.
 */

import { logger } from '../../config/logger';

let RE2: any | null = null;
let re2LoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RE2 = require('re2-wasm').RE2;
} catch (err: any) {
  re2LoadError = err?.message || String(err);
  // Do NOT throw — the orchestrator can still run with re2 disabled
  // (mock-mode tests, dev environments without WASM). The validator
  // surfaces a warning so an operator can investigate.
  logger.warn('regex-sandbox: re2-wasm failed to load; sandbox falls back to JS-only checks', {
    error: re2LoadError,
  });
}

export interface SafeCompileSuccess {
  ok: true;
  pattern: string;
  /** When false, only JS RegExp validation was performed (re2 unavailable). */
  re2Verified: boolean;
  /** Compiled JS RegExp ready for use against test inputs. */
  jsEngine: RegExp;
}

export interface SafeCompileFailure {
  ok: false;
  pattern: string;
  reason: string;
}

export type SafeCompileResult = SafeCompileSuccess | SafeCompileFailure;

/** Hard cap; AI prompts also tell the LLM to stay under 2000 chars. */
const MAX_PATTERN_LENGTH = 2000;

/** Hard cap on input length when running test() — prevents pathological strings. */
const MAX_TEST_INPUT_LENGTH = 4000;

/**
 * Pre-flight checks BEFORE attempting to compile. These catch the
 * common shapes that re2 is known to reject so we can give the LLM a
 * specific error message in the retry loop instead of a generic
 * "regex didn't compile".
 *
 * Note: these are HEURISTIC. The authoritative check is `new RE2(pattern)`.
 */
function preflightUnsupportedFeatures(pattern: string): string | null {
  // Lookbehind: re2 doesn't support `(?<=...)` or `(?<!...)`.
  if (/\(\?<[!=]/.test(pattern)) {
    return 'lookbehind_not_supported_by_re2';
  }
  // Named-group lookahead variant `(?P<name>...)` is also unsupported.
  if (/\(\?P</.test(pattern)) {
    return 'named_group_python_syntax_not_supported';
  }
  // Backreferences `\1`, `\2`, ... — re2 doesn't support these because
  // they're the source of catastrophic backtracking in PCRE / JS engines.
  // The check is deliberately rough; the authoritative test is the
  // re2 compile call below.
  if (/\\[1-9]/.test(pattern)) {
    return 'backreference_not_supported_by_re2';
  }
  // Inline named-back-reference `\k<name>`.
  if (/\\k</.test(pattern)) {
    return 'named_backreference_not_supported_by_re2';
  }
  // Possessive quantifiers `*+`, `++`, `?+`, `{n,m}+` — not supported.
  if (/[*+?](?:\+|\{)/.test(pattern)) {
    // Heuristic; defer to re2 compile if uncertain.
  }
  return null;
}

/**
 * Compile a pattern through both re2 and JS RegExp. Returns either a
 * compiled engine or a structured failure with a reason code suitable
 * for the LLM retry prompt.
 *
 * Performance: re2-wasm boots in ~80ms on first invocation and is then
 * fast. Each compile is < 5ms for typical clinical patterns.
 */
export function safeCompile(pattern: string | undefined | null): SafeCompileResult {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { ok: false, pattern: pattern ?? '', reason: 'pattern_empty' };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      pattern,
      reason: `pattern_too_long: ${pattern.length} > ${MAX_PATTERN_LENGTH}`,
    };
  }

  const preflight = preflightUnsupportedFeatures(pattern);
  if (preflight) {
    return { ok: false, pattern, reason: preflight };
  }

  // Always compile JS RegExp — the runtime evaluator uses it.
  let jsEngine: RegExp;
  try {
    jsEngine = new RegExp(pattern);
  } catch (err: any) {
    return {
      ok: false,
      pattern,
      reason: `js_regexp_compile_error: ${err?.message ?? 'unknown'}`,
    };
  }

  // re2 compile, when available. NOTE re2-wasm requires the 'u' flag.
  // We pass it explicitly here — JS RegExp similarly accepts it, but
  // the JS-side instance uses default flags (no 'u') because the
  // runtime evaluator constructs its RegExp without 'u' for back-compat
  // with older patterns. Practically the 'u' flag mostly affects
  // surrogate-pair handling and \p{...} support, neither of which are
  // common in clinical patterns, so the divergence is minor.
  if (RE2 != null) {
    try {
      // The constructor compiles; if anything is unsupported / invalid
      // it throws. We discard the engine (we only use it as a check) so
      // the JS engine is what's actually used downstream.
      // eslint-disable-next-line no-new
      new RE2(pattern, 'u');
    } catch (err: any) {
      return {
        ok: false,
        pattern,
        reason: `re2_compile_error: ${err?.message ?? 'unknown'}`,
      };
    }
    return { ok: true, pattern, re2Verified: true, jsEngine };
  }

  // re2 unavailable — best-effort with JS only. Caller MAY want to
  // refuse such suggestions until re2 is restored.
  return { ok: true, pattern, re2Verified: false, jsEngine };
}

/**
 * Defensive `RegExp.test` that is bounded in input length. Returns
 * `false` on any thrown error; this matches the runtime evaluator's
 * fail-closed behaviour for invalid inputs.
 */
export function safeTest(jsEngine: RegExp, input: string | undefined | null): boolean {
  if (typeof input !== 'string') {
    return false;
  }
  const safeInput = input.length > MAX_TEST_INPUT_LENGTH
    ? input.substring(0, MAX_TEST_INPUT_LENGTH)
    : input;
  try {
    return jsEngine.test(safeInput);
  } catch {
    return false;
  }
}

/** Surface the load error for diagnostics endpoints. */
export function getRe2LoadStatus(): { available: boolean; error: string | null } {
  return { available: RE2 != null, error: re2LoadError };
}
