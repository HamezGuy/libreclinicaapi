/**
 * Unit Tests for Rule Compiler Service
 *
 * Tests PHI pattern exports, module structure, and scanForPhi.
 * Heavy mocking since this orchestrator has many dependencies.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

type AsyncFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/config/environment', () => ({
  config: {
    ai: {
      enabled: false,
      compilerEnabled: false,
      provider: 'mock',
      maxDescriptionChars: 5000,
      maxFields: 50,
      maxRulesHardCap: 10,
      timeoutMs: 30000,
    },
  },
}));

jest.mock('../../../src/services/database/audit.service', () => ({
  trackUserAction: jest.fn<AsyncFn>().mockResolvedValue(undefined),
}));

jest.mock('../../../src/services/database/validation-rules.service', () => ({
  FORMAT_TYPE_REGISTRY: {
    positive_number: { label: 'Positive number', example: '42', pattern: '^\\d+$' },
  },
}));

jest.mock('../../../src/services/ai/rule-validator.service', () => ({
  validateSuggestions: jest.fn().mockReturnValue({
    accepted: [],
    rejected: [],
    warnings: [],
  }),
  splitForRetry: jest.fn().mockReturnValue({
    retryable: [],
    permanent: [],
  }),
}));

jest.mock('../../../src/services/ai/scope-guard.service', () => ({
  checkScope: jest.fn().mockReturnValue({
    ok: true,
    normalized: 'test description',
    warnings: [],
  }),
}));

jest.mock('../../../src/services/ai/providers/openai-provider', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({
    providerName: 'openai',
    modelId: 'gpt-4o',
    ping: jest.fn<AsyncFn>().mockResolvedValue({ ok: true }),
    generate: jest.fn<AsyncFn>().mockResolvedValue({
      rules: [], warnings: [], inputTokens: 0, outputTokens: 0, costUsd: 0,
    }),
  })),
}));

jest.mock('../../../src/services/ai/providers/gemini-provider', () => ({
  GeminiProvider: jest.fn().mockImplementation(() => ({
    providerName: 'gemini',
    modelId: 'gemini-pro',
    ping: jest.fn<AsyncFn>().mockResolvedValue({ ok: true }),
    generate: jest.fn<AsyncFn>().mockResolvedValue({
      rules: [], warnings: [], inputTokens: 0, outputTokens: 0, costUsd: 0,
    }),
  })),
}));

jest.mock('../../../src/services/ai/providers/mock-provider', () => ({
  MockAiProvider: jest.fn().mockImplementation(() => ({
    providerName: 'mock',
    modelId: 'mock-v1',
    ping: jest.fn<AsyncFn>().mockResolvedValue({ ok: true }),
    generate: jest.fn<AsyncFn>().mockResolvedValue({
      rules: [], warnings: [], inputTokens: 0, outputTokens: 0, costUsd: 0,
    }),
  })),
}));

describe('Rule Compiler Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should import the module without errors', async () => {
    const mod = await import('../../../src/services/ai/rule-compiler.service');
    expect(mod).toBeDefined();
    expect(typeof mod.compileRules).toBe('function');
    expect(typeof mod.scanForPhi).toBe('function');
    expect(typeof mod.__resetCompilerCacheForTests).toBe('function');
    expect(typeof mod.__resetCompilerProviderForTests).toBe('function');
  });

  describe('scanForPhi', () => {
    it('should detect SSN-shaped patterns and always refuse', async () => {
      const { scanForPhi } = await import('../../../src/services/ai/rule-compiler.service');
      const result = scanForPhi('Patient SSN is 123-45-6789');
      expect(result.hasPhi).toBe(true);
      expect(result.patterns).toContain('ssn');
    });

    it('should detect email patterns with patient context', async () => {
      const { scanForPhi } = await import('../../../src/services/ai/rule-compiler.service');
      const result = scanForPhi('The patient email is john@example.com');
      expect(result.hasPhi).toBe(true);
      expect(result.patterns).toContain('email');
    });

    it('should allow email patterns without patient context (warn only)', async () => {
      const { scanForPhi } = await import('../../../src/services/ai/rule-compiler.service');
      const result = scanForPhi('Format must match user@domain.com');
      expect(result.hasPhi).toBe(false);
      expect(result.warnOnly).toBe(true);
      expect(result.patterns).toContain('email');
    });

    it('should return no PHI for clean descriptions', async () => {
      const { scanForPhi } = await import('../../../src/services/ai/rule-compiler.service');
      const result = scanForPhi('Age must be between 18 and 120');
      expect(result.hasPhi).toBe(false);
      expect(result.patterns).toEqual([]);
    });

    it('should return no PHI for null/undefined/empty inputs', async () => {
      const { scanForPhi } = await import('../../../src/services/ai/rule-compiler.service');
      expect(scanForPhi(null).hasPhi).toBe(false);
      expect(scanForPhi(undefined).hasPhi).toBe(false);
      expect(scanForPhi('').hasPhi).toBe(false);
    });

    it('should detect US phone numbers with patient context', async () => {
      const { scanForPhi } = await import('../../../src/services/ai/rule-compiler.service');
      const result = scanForPhi('The patient phone is (555) 123-4567');
      expect(result.hasPhi).toBe(true);
      expect(result.patterns).toContain('phone_us');
    });

    it('should detect ISO date of birth with patient context', async () => {
      const { scanForPhi } = await import('../../../src/services/ai/rule-compiler.service');
      const result = scanForPhi('Subject date of birth is 1990-03-15');
      expect(result.hasPhi).toBe(true);
      expect(result.patterns).toContain('dob_iso');
    });

    it('should allow ISO dates as comparison boundaries (warn only)', async () => {
      const { scanForPhi } = await import('../../../src/services/ai/rule-compiler.service');
      const result = scanForPhi('Date must be after 2025-01-01');
      expect(result.hasPhi).toBe(false);
      expect(result.warnOnly).toBe(true);
      expect(result.patterns).toContain('dob_iso');
    });
  });

  describe('compileRules', () => {
    it('should refuse when AI is disabled', async () => {
      const { compileRules } = await import('../../../src/services/ai/rule-compiler.service');
      const result = await compileRules(
        {
          description: 'Age must be positive',
          fieldContext: [{ path: 'age', label: 'Age', type: 'number', itemId: 1 }],
          existingRules: [],
          maxRules: 5,
          correlationId: 'test-123',
          idempotencyKey: 'key-1',
        },
        { userId: 1, username: 'admin' },
      );
      expect(result.flags.refused).toBe(true);
      expect(result.rules).toEqual([]);
    });
  });

  describe('test seams', () => {
    it('should expose cache reset function', async () => {
      const { __resetCompilerCacheForTests } = await import('../../../src/services/ai/rule-compiler.service');
      expect(() => __resetCompilerCacheForTests()).not.toThrow();
    });

    it('should expose provider reset function', async () => {
      const { __resetCompilerProviderForTests } = await import('../../../src/services/ai/rule-compiler.service');
      expect(() => __resetCompilerProviderForTests()).not.toThrow();
    });
  });
});
