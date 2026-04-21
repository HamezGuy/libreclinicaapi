/**
 * Tiny direct-to-Gemini smoke test that bypasses the orchestrator,
 * validator, schema, and prompt. Just: "is this API key valid?".
 *
 * Usage: npx tsx scripts/verify-gemini-key.ts
 */
/* eslint-disable no-console */
import 'dotenv/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenAI } = require('@google/genai');

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in process.env');
    process.exit(1);
  }
  console.log(`API key present: ${apiKey.substring(0, 8)}…${apiKey.substring(apiKey.length - 4)} (length ${apiKey.length})`);

  const client = new GoogleGenAI({ apiKey });

  const cases = [
    { model: 'gemini-2.5-pro',        label: 'pro' },
    { model: 'gemini-2.5-flash',      label: 'flash' },
    { model: 'gemini-2.5-flash-lite', label: 'flash-lite' },
    { model: 'gemini-2.0-flash',      label: '2.0 flash' },
    { model: 'gemini-1.5-flash',      label: '1.5 flash' },
  ];

  for (const c of cases) {
    process.stdout.write(`Trying ${c.label.padEnd(12)} (${c.model}): `);
    try {
      const t0 = Date.now();
      const resp = await client.models.generateContent({
        model: c.model,
        contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK and nothing else.' }] }],
        // Gemini 2.5 thinking models burn output tokens on internal reasoning
        // before any visible text, so a tight cap (10) returns empty `text`.
        // 4096 matches the orchestrator's production cap.
        config: { temperature: 0, maxOutputTokens: 4096 },
      });
      const text = (resp?.text ?? '').trim();
      const ms = Date.now() - t0;
      const usage = resp?.usageMetadata;
      console.log(`OK (${ms}ms, in=${usage?.promptTokenCount ?? '?'} out=${usage?.candidatesTokenCount ?? '?'} thoughts=${(usage as any)?.thoughtsTokenCount ?? '?'}) -> "${text.substring(0, 50)}"`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      // Try to surface the structured Gemini error for clarity.
      const code = msg.match(/"code":\s*(\d+)/)?.[1] || '?';
      const status = msg.match(/"status":\s*"([^"]+)"/)?.[1] || '?';
      console.log(`FAIL [code=${code} status=${status}] ${msg.substring(0, 200)}`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err?.message || String(err));
  process.exit(0);
});
