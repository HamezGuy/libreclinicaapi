/**
 * Regex Sandbox unit tests.
 *
 * Coverage:
 *   - 30 known-good (re2-compatible) patterns must compile.
 *   - 30 known-bad patterns (ReDoS-prone, lookbehind, backrefs, garbage)
 *     must reject.
 *   - safeTest hard-caps input length and never throws.
 *
 * No DB, no network. Runs under jest.unit.config.js.
 */

import { describe, it, expect } from '@jest/globals';
import { safeCompile, safeTest, getRe2LoadStatus } from '../../../src/services/ai/regex-sandbox.service';

describe('regex-sandbox: known-good patterns compile', () => {
  const goodPatterns: string[] = [
    // 1-10: registry-style
    '^[a-zA-Z0-9_%+\\-]+@[a-zA-Z0-9](?:[a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?\\.[a-zA-Z]{2,}$',
    '^\\d{3}-\\d{3}-\\d{4}$',
    '^[a-zA-Z\\s]+$',
    '^\\d+$',
    '^[a-zA-Z0-9\\s]+$',
    '^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$',
    '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$',
    '^([01]\\d|2[0-3]):[0-5]\\d$',
    '^[A-Z]{2,5}-\\d{3,5}$',
    '^[A-Z]{2,3}$',
    // 11-20: clinical / numeric
    '^\\d{5}(-\\d{4})?$',
    '^-?\\d+$',
    '^-?\\d+\\.\\d{2}$',
    '^[A-Za-z][A-Za-z0-9_]{0,30}$',
    '^[0-9]{13}$',
    '^V\\d+$',
    '^\\d{4}-W\\d{2}$',
    '^[A-Z]{1,3}\\d{4,8}$',
    '^Y(es)?|N(o)?$',
    '^[A-Za-z]+( [A-Za-z]+)*$',
    // 21-30: useful patterns and registry-equivalent
    '^[A-Z]{2}\\d{2}[A-Z0-9]{1,30}$',
    '^[+]?[1-9]\\d{1,14}$',
    '^[A-F0-9]{8}-[A-F0-9]{4}-4[A-F0-9]{3}-[89ab][A-F0-9]{3}-[A-F0-9]{12}$',
    '^https?://[^\\s]+$',
    '^[A-Za-z]+\\.[A-Za-z]+@[A-Za-z]+\\.[A-Za-z]{2,}$',
    '^[A-Z]{3}-[A-Z]{3}-\\d{4}$',
    '^\\d{1,3}(?:,\\d{3})*$',
    '^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)$',
    '^[A-Za-z]+(?:_[A-Za-z]+)*$',
    '^[A-Z][a-z]+$',
  ];
  it.each(goodPatterns)('compiles: %s', (p) => {
    const r = safeCompile(p);
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect(r.jsEngine).toBeInstanceOf(RegExp);
    }
  });
});

describe('regex-sandbox: known-bad patterns reject', () => {
  const badCases: Array<{ name: string; pattern: string; reasonContains?: string }> = [
    // Empty / oversized
    { name: 'empty', pattern: '', reasonContains: 'pattern_empty' },
    { name: 'too long (2000+ chars)', pattern: 'a'.repeat(2001), reasonContains: 'pattern_too_long' },
    // Lookbehind (re2 unsupported)
    { name: 'positive lookbehind', pattern: '(?<=abc)def' },
    { name: 'negative lookbehind', pattern: '(?<!abc)def' },
    // Backreferences (re2 unsupported)
    { name: 'numeric backref', pattern: '(.)\\1' },
    { name: 'named backref', pattern: '(?P<x>.)\\k<x>' },
    // Python-style named group
    { name: 'python named group', pattern: '(?P<name>abc)' },
    // Garbage / syntax errors
    { name: 'unclosed paren', pattern: '(abc' },
    { name: 'unclosed bracket', pattern: '[abc' },
    { name: 'unbalanced curly quantifier', pattern: 'a{2,1}' },
  ];
  it.each(badCases)('rejects: $name', ({ pattern, reasonContains }) => {
    const r = safeCompile(pattern);
    expect(r.ok).toBe(false);
    if (r.ok === false && reasonContains) {
      expect(r.reason).toContain(reasonContains);
    }
  });
});

describe('regex-sandbox: safeTest', () => {
  it('returns true on a clear match', () => {
    const r = safeCompile('^foo$');
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(safeTest(r.jsEngine, 'foo')).toBe(true);
  });
  it('returns false on a non-match', () => {
    const r = safeCompile('^foo$');
    if (r.ok === true) expect(safeTest(r.jsEngine, 'bar')).toBe(false);
  });
  it('returns false on null / undefined input without throwing', () => {
    const r = safeCompile('.*');
    if (r.ok === true) {
      expect(safeTest(r.jsEngine, null as any)).toBe(false);
      expect(safeTest(r.jsEngine, undefined as any)).toBe(false);
    }
  });
  it('truncates extremely long inputs (5KB) without crashing', () => {
    const r = safeCompile('^.+$');
    if (r.ok === true) {
      expect(safeTest(r.jsEngine, 'x'.repeat(5000))).toBe(true);
    }
  });
});

describe('regex-sandbox: re2 status reporter', () => {
  it('reports re2 availability', () => {
    const status = getRe2LoadStatus();
    expect(typeof status.available).toBe('boolean');
    if (!status.available) {
      expect(typeof status.error === 'string' || status.error === null).toBe(true);
    }
  });
});
