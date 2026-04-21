/**
 * PHI scanner unit tests.
 *
 * The PHI scanner used to live in its own service file. After the v2
 * refactor it lives inline in `rule-compiler.service.ts` (six regexes
 * don't need their own module). Only the description-text scanner is
 * exported; the field-shape scanner is internal and tested indirectly
 * via the orchestrator's `containedPhi` flag.
 */
import { describe, it, expect } from '@jest/globals';
import { scanForPhi } from '../../../src/services/ai/rule-compiler.service';

describe('phi-scanner: clean text passes', () => {
  const clean = [
    'Make this field required',
    'Must be between 1 and 100',
    'Must be a valid email',
    'Flag if the response is Yes',
    'Subject ID must look like SITE-001',
    '', // empty is fine
  ];
  it.each(clean)('clean: %s', (txt) => {
    const r = scanForPhi(txt);
    expect(r.hasPhi).toBe(false);
    expect(r.patterns).toEqual([]);
  });
});

describe('phi-scanner: PHI shapes are detected', () => {
  it('detects SSN', () => {
    expect(scanForPhi('patient SSN 123-45-6789').hasPhi).toBe(true);
    expect(scanForPhi('patient SSN 123-45-6789').patterns).toContain('ssn');
  });
  it('detects MRN', () => {
    expect(scanForPhi('see MRN 1234567 in chart').hasPhi).toBe(true);
    expect(scanForPhi('MRN: 1234567').hasPhi).toBe(true);
    expect(scanForPhi('MRN#1234567').hasPhi).toBe(true);
  });
  it('detects email', () => {
    expect(scanForPhi('contact john.doe@example.com').hasPhi).toBe(true);
    expect(scanForPhi('contact john.doe@example.com').patterns).toContain('email');
  });
  it('detects US phone (paren)', () => {
    expect(scanForPhi('(123) 456-7890').hasPhi).toBe(true);
  });
  it('detects US phone (dash)', () => {
    expect(scanForPhi('reach 123-456-7890').hasPhi).toBe(true);
  });
  it('detects DOB ISO', () => {
    expect(scanForPhi('born 1990-04-15').hasPhi).toBe(true);
  });
  it('detects DOB US', () => {
    expect(scanForPhi('born 04/15/1990').hasPhi).toBe(true);
  });
});

// scanFieldsForPhi is internal to the orchestrator now. Its behaviour
// is exercised end-to-end via the live PowerShell tests
// (verify-ai-compile.ps1) — a unit test would just duplicate scanForPhi
// across an array of strings, which we already cover above.
