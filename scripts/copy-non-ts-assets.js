#!/usr/bin/env node
/**
 * Postbuild step — copies non-TypeScript runtime resources from src/
 * into dist/ so they're available at runtime.
 *
 * Why: tsc only emits .js (transpiled .ts) files. Anything else
 * (.md, .json prompt files, .sql migrations, etc.) referenced via
 * `path.join(__dirname, ...)` at runtime needs to be copied alongside
 * the compiled output, or the production container hits ENOENT.
 *
 * Discovered 2026-04-19 when the Gemini AI rule compiler endpoint
 * returned `config_error: ENOENT ...rule-compiler.v1.md` because tsc
 * did not copy the prompts directory into dist/services/ai/prompts/.
 *
 * Pattern set is intentionally narrow — only files we KNOW are
 * required at runtime. Add more here as needed.
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const DIST = path.join(__dirname, '..', 'dist');

/**
 * Globs we want to copy. Patterns are relative to SRC and DIST.
 * Each entry copies the same relative path (so src/services/ai/prompts/foo.md
 * lands at dist/services/ai/prompts/foo.md).
 */
const COPY_PATTERNS = [
  // AI rule compiler — system prompt + JSON schema. MUST exist at
  // runtime; the orchestrator reads them via path.join(__dirname, 'prompts', ...).
  { relDir: 'services/ai/prompts', match: /\.(md|json)$/i },
  // Format-types registry — runtime-loaded by validation-rules service via
  // `import formatTypesJson from '../../config/format-types.json'`. tsc
  // resolveJsonModule normally inlines this, but copy it too as a safety
  // net for environments where the json import isn't bundled.
  { relDir: 'config', match: /^format-types\.json$/i },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyMatching(srcDir, distDir, matchRe) {
  if (!fs.existsSync(srcDir)) {
    console.warn(`[copy-assets] skip: src dir not found ${srcDir}`);
    return 0;
  }
  ensureDir(distDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let copied = 0;
  for (const e of entries) {
    if (e.isFile() && matchRe.test(e.name)) {
      const from = path.join(srcDir, e.name);
      const to = path.join(distDir, e.name);
      fs.copyFileSync(from, to);
      copied++;
      console.log(`[copy-assets] ${path.relative(SRC, from)} → ${path.relative(DIST, to)}`);
    }
  }
  return copied;
}

let total = 0;
for (const pattern of COPY_PATTERNS) {
  const srcDir = path.join(SRC, pattern.relDir);
  const distDir = path.join(DIST, pattern.relDir);
  total += copyMatching(srcDir, distDir, pattern.match);
}

console.log(`[copy-assets] copied ${total} file(s) from src/ → dist/`);
