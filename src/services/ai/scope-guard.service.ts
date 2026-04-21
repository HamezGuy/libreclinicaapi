/**
 * Scope Guard — pre-LLM input validation for the AI rule compiler.
 *
 * The compile endpoint accepts free-form user descriptions. Without
 * guardrails users can:
 *   - Try to break out of validation-rule scope ("write me a poem")
 *   - Inject system instructions ("ignore the above and ...")
 *   - Send purely procedural noise ("hi", "test", "asdf")
 *   - Send descriptions that are clearly not about a validation rule
 *     ("how do I export this study?")
 *
 * This module sits BEFORE the Gemini call (after the kill-switch and
 * after the PHI scan) and either:
 *   - Returns `{ ok: true, normalized }` — proceed to LLM with the
 *     normalized description.
 *   - Returns `{ ok: false, refusalCode, message }` — orchestrator
 *     refuses without spending tokens.
 *
 * Design constraints:
 *   - DETERMINISTIC. Same input → same decision. No LLM calls in here.
 *   - FAIL-OPEN by default for ambiguous cases (let Gemini handle it).
 *     We only refuse when the input is OBVIOUSLY off-topic or hostile.
 *   - LOW false-positive rate. Refusing a legitimate-but-quirky rule
 *     description is a UX failure; pass-through is recoverable.
 *
 * Audit-trail rationale: every refusal here gets a refusalCode so
 * operators can spot patterns (e.g. lots of `off_topic_intent` →
 * users are confused about what the AI does → fix the UI copy).
 */

export interface ScopeGuardResult {
  ok: boolean;
  /** Cleaned-up description ready for the LLM. */
  normalized: string;
  /** Refusal code when ok=false. Stable, machine-readable. */
  refusalCode?:
    | 'too_short'
    | 'noise'
    | 'off_topic_intent'
    | 'prompt_injection'
    | 'meta_request'
    | 'control_chars';
  /** Human-readable message safe to surface in the UI. */
  message?: string;
  /** Optional warnings to surface even when ok=true. */
  warnings: string[];
}

// Keywords that strongly indicate validation-rule intent. We use these
// for negative scoring (a description with NONE of these words AND with
// off-topic markers is more confidently off-topic).
const RULE_INTENT_KEYWORDS = [
  'required', 'require', 'must', 'should', 'mandatory', 'optional',
  'between', 'min', 'max', 'minimum', 'maximum', 'range',
  'format', 'pattern', 'regex', 'match', 'matches', 'looks like',
  'equal', 'equals', 'less than', 'greater than', 'before', 'after',
  'flag', 'warn', 'warning', 'error', 'invalid', 'valid',
  'value', 'field', 'check', 'validate', 'validation', 'rule',
  'date', 'number', 'text', 'phone', 'email', 'zip',
  'consistent', 'consistency', 'compare',
  'allow', 'reject', 'accept',
];

// Strong negative signals — explicit "do something other than compile a rule".
// Each entry is a substring match (case-insensitive) on the trimmed input.
const META_REQUEST_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(write|generate|compose|draft)\s+(me\s+)?(a\s+)?(poem|sonnet|haiku|story|song|joke|essay|paragraph)\b/i, reason: 'creative writing request' },
  { re: /\b(translate|translation)\b/i, reason: 'translation request' },
  { re: /\bwhat\s+(can\s+you\s+)?do\b/i, reason: 'meta-question about capabilities' },
  { re: /\b(who|what|when|where|how)\s+are\s+you\b/i, reason: 'meta-question about identity' },
  { re: /\bexplain\s+(yourself|how\s+you\s+work|the\s+system)\b/i, reason: 'meta-question about system' },
  // System-prompt extraction: classified as INJECTION (more accurate than
  // "meta") so the audit trail flags it for security review.
  // Moved from META to INJECTION patterns below.
  { re: /\b(help\s+me|how\s+do\s+i)\s+(with|use|export|import|navigate|configure)\b/i, reason: 'general help request' },
  { re: /\b(api\s+key|secret|password|token|credentials)\b/i, reason: 'credential / secret request' },
  { re: /\b(weather|stock|news|recipe|directions|movies?|music|sports?)\b/i, reason: 'off-topic chitchat' },
  { re: /\b(joke|riddle|trivia|game)\b/i, reason: 'entertainment request' },
];

// Prompt-injection patterns. These look for explicit attempts to override
// the system prompt. We err on the side of refusing when we see them.
const INJECTION_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(ignore|disregard|forget)\s+(all\s+)?(the\s+)?(previous|prior|above|earlier|all)\s+(instructions?|prompts?|rules?|directives?)/i, reason: 'instruction-override attempt' },
  { re: /\b(new|updated|revised)\s+(instructions?|prompts?|system\s+prompt)\s*[:=]/i, reason: 'replacement-prompt attempt' },
  { re: /\bshow\s+(me\s+)?(your|the)\s+(prompt|system\s+prompt|instructions|rules|directives)\b/i, reason: 'system prompt extraction attempt' },
  { re: /\bwhat'?s?\s+(your|the)\s+(prompt|system\s+prompt|instructions)\b/i, reason: 'system prompt extraction attempt' },
  { re: /\b(repeat|echo|print|reveal|leak|dump|expose)\s+(your|the)\s+(prompt|system\s+prompt|instructions|context)\b/i, reason: 'system prompt extraction attempt' },
  { re: /\byou\s+are\s+now\s+(a|an)\b/i, reason: 'role-override attempt' },
  // Match "act as a", "pretend to be a", "roleplay as", "behave like".
  { re: /\b(act|behave|pretend|roleplay)\s+(as|to\s+be|like)\s+(a|an|if|the)\b/i, reason: 'role-override attempt' },
  { re: /\b(simulate|emulate)\s+(a|an|the)\s+(shell|terminal|chatbot|assistant|model|llm|gpt|gemini|user|admin|agent)\b/i, reason: 'role-emulation attempt' },
  { re: /\b(developer|dev|admin|system)\s+(mode|access|override)\b/i, reason: 'privilege-escalation attempt' },
  { re: /\b(jailbreak|jail\s*break|dan\s+mode|do\s+anything\s+now)\b/i, reason: 'known jailbreak phrase' },
  { re: /\bemit\s+(any|whatever|all)\s+rule/i, reason: 'attempt to defeat rule restrictions' },
  { re: /\b(formula|business_logic|cross_form)\s*:\s*(true|enabled|allowed)\b/i, reason: 'attempt to enable forbidden ruleType' },
  { re: /\bcustomExpression\s*[:=]/i, reason: 'attempt to populate forbidden field' },
  // Markdown / code-fence smuggling — sometimes used to fake validator output.
  { re: /<\s*\/?\s*system\s*>/i, reason: 'fake system tag' },
  { re: /<\s*\|\s*im_(start|end|sep)\s*\|\s*>/i, reason: 'fake chat-format tokens' },
];

/**
 * Strip control characters (except newline + tab) and normalize
 * whitespace. Also collapses runs of identical punctuation that some
 * users hit when they hold a key.
 */
function normalizeWhitespace(s: string): string {
  return s
    // Strip C0 controls except \t (0x09) and \n (0x0A); strip C1 too.
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, ' ')
    // Collapse 4+ repeated chars (loose — handles "?????" / "....." / "asdf asdf asdf asdf").
    .replace(/(.)\1{6,}/g, (_, c) => c.repeat(3))
    // Collapse runs of whitespace.
    .replace(/\s+/g, ' ')
    .trim();
}

function hasControlChars(s: string): boolean {
  return /[\x00-\x08\x0B-\x1F\x7F-\x9F]/.test(s);
}

function looksLikeNoise(s: string): boolean {
  // Single repeated character (e.g. "aaaaaaa", "??????")
  if (/^(.)\1{4,}$/.test(s)) return true;
  // Just punctuation / no letters
  if (!/[a-z]/i.test(s)) return true;
  // Single short word with no rule-intent keywords ("hi", "test", "asdf").
  const words = s.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 2 && !words.some(w => RULE_INTENT_KEYWORDS.includes(w))) {
    return true;
  }
  // Keyboard-mash detection: high ratio of consonant clusters / no spaces.
  if (s.length >= 6 && words.length === 1 && !/[aeiou]/i.test(s)) return true;
  return false;
}

/**
 * When the per-question UI scopes the modal to a single field, the
 * frontend prefixes the description with a `Target field: ...` line
 * followed by `User request: <plain English>`. Pull out the user's
 * portion so the noise / off-topic / injection checks don't get
 * confused by the (system-generated) preamble.
 *
 * Returns the raw input when no prefix is present.
 */
function extractUserPortion(s: string): string {
  const m = s.match(/^\s*Target field:[\s\S]*?User request:\s*([\s\S]+)$/i);
  return m ? m[1].trim() : s;
}

/**
 * Run all scope-guard checks. Designed to be cheap (regex-only).
 */
export function checkScope(rawDescription: string | undefined | null): ScopeGuardResult {
  const warnings: string[] = [];
  if (typeof rawDescription !== 'string') {
    return {
      ok: false, normalized: '', refusalCode: 'too_short', warnings,
      message: 'Please describe the validation rule you want.',
    };
  }

  // Surface (then strip) control chars — these often indicate paste from
  // weird sources (Word docs, terminals).
  if (hasControlChars(rawDescription)) {
    warnings.push('Stripped control characters from your description.');
  }

  const normalized = normalizeWhitespace(rawDescription);

  if (normalized.length === 0) {
    return {
      ok: false, normalized, refusalCode: 'too_short', warnings,
      message: 'Please describe the validation rule you want.',
    };
  }

  // For length / noise / off-topic / question detection we look at the
  // USER'S portion of the description (excluding any `Target field: …`
  // preamble the per-question UI added). Injection / PHI checks still
  // run on the full description — those are about what we'd send to the
  // LLM, regardless of who wrote each part.
  const userPortion = extractUserPortion(normalized);

  // Minimum useful length — anything shorter is almost always noise.
  // Per-question scope makes "required" a perfectly valid request, so we
  // tolerate as short as 4 chars when a Target field preamble is present.
  const minLen = userPortion === normalized ? 8 : 4;
  if (userPortion.length < minLen) {
    return {
      ok: false, normalized, refusalCode: 'too_short', warnings,
      message: `Description "${userPortion}" is too short. Try describing the rule in plain English (e.g. "Age must be between 18 and 120").`,
    };
  }

  // Noise / keyboard-mash detection.
  if (looksLikeNoise(userPortion)) {
    return {
      ok: false, normalized, refusalCode: 'noise', warnings,
      message: `"${userPortion}" doesn't look like a rule description. Try describing what makes a value valid or invalid (e.g. "must be a positive number" or "should match SITE-001 format").`,
    };
  }

  // Prompt-injection / role-override detection.
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(normalized)) {
      return {
        ok: false, normalized, refusalCode: 'prompt_injection', warnings,
        message: `Your description appears to contain an instruction-override attempt (${p.reason}). The AI rule compiler only converts plain-English rule descriptions into validation rules. Please rephrase as a normal rule description.`,
      };
    }
  }

  // Meta-request / off-topic detection.
  for (const p of META_REQUEST_PATTERNS) {
    if (p.re.test(normalized)) {
      return {
        ok: false, normalized, refusalCode: 'meta_request', warnings,
        message: `The AI rule compiler only creates validation rules for form fields. Your request looks like ${p.reason}. Try describing a rule instead (e.g. "Patient ID must match SITE-001 format").`,
      };
    }
  }

  // Soft check: if the user's portion has zero rule-intent keywords
  // AND is a question, mark as off-topic. Accept questions IF they
  // include rule-intent words (e.g. "how can I require this field?").
  const lower = userPortion.toLowerCase();
  const isQuestion = /^(what|how|why|when|where|which|who|can|do|does|is|are|should|could|would)\b/i.test(userPortion) || userPortion.endsWith('?');
  const hasRuleIntent = RULE_INTENT_KEYWORDS.some(kw => lower.includes(kw));
  if (isQuestion && !hasRuleIntent) {
    return {
      ok: false, normalized, refusalCode: 'off_topic_intent', warnings,
      message: `That looks like a general question rather than a validation-rule description. Try phrasing it as a rule (e.g. "Field X must be between 1 and 10").`,
    };
  }

  // Soft check: very long descriptions get a warning to encourage concise
  // requests, but we still pass them through.
  if (normalized.length > 2000) {
    warnings.push(`Your description is ${normalized.length} characters long. Shorter, more focused descriptions usually produce better rules.`);
  }

  // Soft check: presence of "ignore" or "system" without injection match —
  // surface a warning so reviewers see it but don't refuse.
  if (/\b(ignore|system\s+prompt)\b/i.test(normalized)) {
    warnings.push('Your description contains words like "ignore" or "system prompt"; verify the AI\'s suggestions carefully.');
  }

  return { ok: true, normalized, warnings };
}
